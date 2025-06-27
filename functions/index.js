const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onObjectFinalized} = require("firebase-functions/v2/storage");
const {defineSecret} = require("firebase-functions/params");
const {OpenAI} = require("openai");
const admin = require("firebase-admin");

admin.initializeApp();

// Define the secret for the OpenAI API key
const openaiApiKey = defineSecret("OPENAI_API_KEY");

exports.generateEmail = onCall({secrets: [openaiApiKey]}, async (request) => {
  // 1. Extract data from the request
  const {userProfile, representative} = request.data;

  // Validate input data
  if (!representative) {
    throw new HttpsError("invalid-argument", "Representative data is required.");
  }
  if (!userProfile) {
    throw new HttpsError("invalid-argument", "User profile data is required.");
  }

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
    - Name: ${representative.representative_name || representative.name || 'Unknown'}
    - Party: ${representative.party || 'Unknown'}
    - District: ${representative.district || 'Unknown'}

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
