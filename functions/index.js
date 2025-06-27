const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onObjectFinalized} = require("firebase-functions/v2/storage");
const {defineSecret} = require("firebase-functions/params");
const {OpenAI} = require("openai");
const admin = require("firebase-admin");

admin.initializeApp();

// Define the secret for the OpenAI API key
const openaiApiKey = defineSecret("OPENAI_API_KEY");
const googleCivicApiKey = defineSecret("GOOGLE_CIVIC_API_KEY");

exports.getRepresentatives = onCall({secrets: [googleCivicApiKey]}, async (request) => {
  const { zipCode } = request.data;
  if (!zipCode) {
    throw new HttpsError("invalid-argument", "The function must be called with a zipCode.");
  }

  const axios = require("axios");
  const apiKey = googleCivicApiKey.value();
  const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${zipCode}&key=${apiKey}&levels=administrativeArea1&roles=legislatorUpperBody&roles=legislatorLowerBody`;

  try {
    const response = await axios.get(url);
    const { offices, officials } = response.data;
    const representatives = [];

    if (offices && officials) {
      offices.forEach(office => {
        if (office.divisionId.includes("country:us/state:tx")) {
          office.officialIndices.forEach(index => {
            const official = officials[index];
            representatives.push({
              id: `civic-${official.name.replace(/\s+/g, "-").toLowerCase()}`,
              name: official.name,
              party: official.party,
              phone: official.phones ? official.phones[0] : "N/A",
              email: official.emails ? official.emails[0] : "N/A",
              district: office.name,
            });
          });
        }
      });
    }
    return { representatives };
  } catch (error) {
    console.error("Error fetching representatives:", error);
    throw new HttpsError("internal", "Failed to fetch representatives.", error);
  }
});

exports.generateEmail = onCall({secrets: [openaiApiKey]}, async (request) => {
  // 1. Extract data from the request
  const {userProfile, representative} = request.data;

  // 2. Initialize OpenAI with the secret key
  const openai = new OpenAI({
    apiKey: openaiApiKey.value(),
  });

  // 3. Helper functions to format regulations
  const formatRegulations = (regulations, type) => {
    if (!regulations || regulations.length === 0) {
      return `- Regulations the sender ${type.toUpperCase()}: None specified`;
    }
    const regulationsList = regulations
        .map((r) => `\n  - ${r.regulation} (Caveat: ${r.caveat || "None"})`)
        .join("");
    return `- Regulations the sender ${type.toUpperCase()}: ${regulationsList}`;
  };

  // 4. Construct a detailed prompt for the LLM
  const prompt = `
    Generate a professional and respectful email to a legislator.
    
    **Recipient:**
    - Name: ${representative.name}
    - Party: ${representative.party}
    - District: ${representative.district}

    **Sender's Profile:**
    - Name: ${userProfile.userFullName}
    - Location: ${userProfile.userLocation}
    - Works in Hemp Industry: ${userProfile.intelligentDraftingProfile.worksInHempIndustry ? "Yes" : "No"}
    - Occupation: ${userProfile.intelligentDraftingProfile.occupation || "Not specified"}

    **Communication Style:**
    - Primary Tone: ${userProfile.intelligentDraftingProfile.communicationTone.primaryTone}
    - Personality Elements: ${userProfile.intelligentDraftingProfile.communicationTone.personalityElements.join(", ")}

    **Key Message Points:**
    - Personal impact of a THC ban: ${userProfile.intelligentDraftingProfile.banImpactStatement}
    - Additional comments: ${userProfile.intelligentDraftingProfile.additionalComments}
    ${formatRegulations(userProfile.intelligentDraftingProfile.supportedRegulations, "supports")}
    ${formatRegulations(userProfile.intelligentDraftingProfile.opposedRegulations, "opposes")}

    **Instructions:**
    - Draft a compelling email subject and body.
    - The email should be concise, persuasive, and tailored to the recipient's political party and district if possible.
    - Incorporate the sender's personal story and regulation preferences naturally.
    - The tone should reflect the sender's selected style.
    - The email should be ready to send. Do not include any introductory text like "Here is the draft".
    - Return the response as a JSON object with "subject" and "body" fields.
  `;

  try {
    // 5. Call the OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{role: "user", content: prompt}],
      response_format: {type: "json_object"},
    });

    // 6. Return the generated email
    const emailContent = JSON.parse(response.choices[0].message.content);
    return {
      subject: emailContent.subject,
      body: emailContent.body,
    };
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw new HttpsError("internal", "Failed to generate email.", error);
  }
});

exports.updateContactListManifest = onObjectFinalized({bucket: "sb3calltool.appspot.com"}, async (event) => {
  const file = event.data;
  const filePath = file.name; // e.g., 'contacts/new_list.json'
  const fileName = filePath.split("/").pop();

  // Exit if the file is not in the 'contacts' directory, or is the manifest itself
  if (!filePath.startsWith("contacts/") || fileName === "manifest.json") {
    console.log(`Ignoring file: ${filePath}`);
    return null;
  }

  // Exit if the file is not a JSON file
  if (!fileName.endsWith(".json")) {
    console.log(`Ignoring non-JSON file: ${filePath}`);
    return null;
  }

  const bucket = admin.storage().bucket(file.bucket);
  const manifestFile = bucket.file("contacts/manifest.json");

  try {
    // Download and parse the existing manifest
    const manifestContents = await manifestFile.download();
    const manifest = JSON.parse(manifestContents.toString());

    // Add the new file to the list if it's not already there
    if (!manifest.contact_lists.includes(fileName)) {
      console.log(`Adding ${fileName} to manifest.json`);
      manifest.contact_lists.push(fileName);

      // Sort the lists based on the numeric prefix
      manifest.contact_lists.sort((a, b) => {
        const numA = parseInt(a.split("_")[0], 10);
        const numB = parseInt(b.split("_")[0], 10);
        return numA - numB;
      });

      // Upload the updated manifest
      await manifestFile.save(JSON.stringify(manifest, null, 2), {
        contentType: "application/json",
      });
      console.log("manifest.json updated successfully.");
    } else {
      console.log(`${fileName} already exists in manifest.json. No update needed.`);
    }
    return null;
  } catch (error) {
    // If manifest.json doesn't exist, create it with the new file
    if (error.code === 404) {
      console.log("manifest.json not found. Creating a new one.");
      const newManifest = {
        contact_lists: [fileName],
      };
      await manifestFile.save(JSON.stringify(newManifest, null, 2), {
        contentType: "application/json",
      });
      console.log("New manifest.json created successfully.");
      return null;
    }
    console.error("Error updating manifest.json:", error);
    throw error; // Re-throw the error to signal failure
  }
});
