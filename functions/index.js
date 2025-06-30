const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onObjectFinalized} = require("firebase-functions/v2/storage");
const {defineSecret} = require("firebase-functions/params");
const {OpenAI} = require("openai");
const admin = require("firebase-admin");

admin.initializeApp();

// Define the secret for the OpenAI API key
const openaiApiKey = defineSecret("OPENAI_API_KEY");

exports.generateSubjectLines = onCall({secrets: [openaiApiKey]}, async (request) => {
  // Extract user profile from the request
  const {userProfile} = request.data;

  // Validate input data
  if (!userProfile) {
    throw new HttpsError("invalid-argument", "User profile data is required.");
  }

  // Initialize OpenAI with the secret key
  const openai = new OpenAI({
    apiKey: openaiApiKey.value(),
  });

  // Construct prompt for multiple subject lines
  const prompt = `
    Generate 5 different compelling email subject lines for emails to Texas legislators about hemp regulation.
    
    **Context:**
    - The sender is advocating for common-sense hemp regulation instead of prohibition
    - Key talking points: jobs, tax revenue, consumer safety, personal freedom
    - The tone should be professional but attention-grabbing
    - Each subject should be unique and take a slightly different angle
    
    **Sender's Profile:**
    - Works in Hemp Industry: ${userProfile.intelligentDraftingProfile?.worksInHempIndustry ? "Yes" : "No"}
    - Primary Tone: ${userProfile.intelligentDraftingProfile?.communicationTone?.primaryTone || "Professional"}
    
    **Instructions:**
    - Generate exactly 5 subject lines
    - Each should be 50-80 characters max
    - Make them varied - some urgent, some economic-focused, some personal, etc.
    - Return as a JSON object with a "subjects" array
    
    Example format:
    {
      "subjects": [
        "Support Texas Jobs - Regulate, Don't Ban Hemp",
        "Your Constituent Urges Smart Hemp Policy",
        "Protect 53,000 Texas Jobs with Hemp Regulation",
        "Common-Sense Hemp Rules Benefit All Texans",
        "Urgent: Vote for Hemp Regulation, Not Prohibition"
      ]
    }
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{role: "user", content: prompt}],
      response_format: {type: "json_object"},
      temperature: 0.9, // Higher temperature for more variety
    });

    const result = JSON.parse(response.choices[0].message.content);
    return {
      subjects: result.subjects || []
    };
  } catch (error) {
    console.error("Error calling OpenAI API for subject lines:", error);
    throw new HttpsError("internal", "Failed to generate subject lines.", error);
  }
});

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

  // 3. Helper functions
  
  // Check if user is a constituent of the representative
  const isUserConstituentOf = (userProfile, representative) => {
    if (!userProfile.assignedDistricts || !representative.district) {
      return false;
    }
    
    const repDistrict = String(representative.district);
    const districts = userProfile.assignedDistricts;
    
    // Check both House and Senate districts
    if (districts.houseDistricts && districts.houseDistricts.includes(repDistrict)) {
      return true;
    }
    
    if (districts.senateDistricts && districts.senateDistricts.includes(repDistrict)) {
      return true;
    }
    
    return false;
  };
  
  // Determine appropriate user descriptor based on profile
  const getUserDescriptor = (userProfile, isConstituent) => {
    if (isConstituent) {
      return `your constituent from ${userProfile.userLocation || 'your district'}`;
    }
    
    // Not a constituent - use descriptive language
    const profile = userProfile.intelligentDraftingProfile || {};
    
    if (profile.worksInHempIndustry) {
      return "concerned hemp industry professional from Texas";
    }
    
    // Based on tone preference
    const tone = profile.communicationTone?.primaryTone;
    if (tone === 'CIVIC_PATRIOTIC') {
      return "proud Texan";
    } else if (tone === 'CONCERNED' || tone === 'URGENT_RESPECT') {
      return "concerned Texas citizen";
    } else if (tone === 'COMMUNITY_VOICE') {
      return "engaged member of the Texas community";
    }
    
    // Default based on location
    const location = userProfile.userLocation || '';
    if (location && !location.toLowerCase().includes('texas')) {
      return `${location} resident and concerned Texan`;
    }
    
    return "concerned Texan";
  };
  
  // Format name from "Lastname, Firstname" to "Firstname Lastname" with proper casing
  const formatRepName = (name) => {
    if (!name) return 'Representative';
    
    // Convert to proper case
    const toProperCase = (str) => {
      return str.replace(/\w\S*/g, (txt) => 
        txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
      );
    };
    
    // Check if name is in "Lastname, Firstname" format
    if (name.includes(',')) {
      const parts = name.split(',').map(part => part.trim());
      if (parts.length === 2) {
        // Reorder to "Firstname Lastname" and apply proper case
        return toProperCase(`${parts[1]} ${parts[0]}`);
      }
    }
    
    // If not in comma format, just apply proper case
    return toProperCase(name);
  };
  
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
  const formattedRepName = formatRepName(representative.representative_name || representative.name);
  const isConstituent = isUserConstituentOf(userProfile, representative);
  const userDescriptor = getUserDescriptor(userProfile, isConstituent);
  
  const prompt = `
    Generate a professional and respectful email to a legislator.
    
    **Recipient:**
    - Name: ${formattedRepName}
    - Party: ${representative.party || 'Unknown'}
    - District: ${representative.district || 'Unknown'}

    **Sender's Profile:**
    - Name: ${userProfile.userFullName}
    - User Descriptor: ${userDescriptor}
    - Is Direct Constituent: ${isConstituent ? "Yes" : "No"}
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
    - IMPORTANT: In the introduction, identify the sender as "${userDescriptor}" - do NOT claim to be a constituent if "Is Direct Constituent" is "No".
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
