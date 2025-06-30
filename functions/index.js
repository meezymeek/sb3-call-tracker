const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onObjectFinalized} = require("firebase-functions/v2/storage");
const {defineSecret} = require("firebase-functions/params");
const {OpenAI} = require("openai");
const admin = require("firebase-admin");

admin.initializeApp();

// Import the new zip code functions
const {getRepresentativesByZipCode, getRepresentativesForMultipleZips} = require("./getRepsByZipCode");

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

  const profile = userProfile.intelligentDraftingProfile || {};
  const tone = profile.communicationTone || {};
  
  // Construct prompt for multiple subject lines
  const prompt = `
    Generate 5 different compelling email subject lines for emails to Texas legislators about hemp regulation. Each subject line should reflect the sender's communication style while effectively advocating for regulation over prohibition.
    
    **ISSUE CONTEXT:**
    - Texas hemp industry supports 53,000+ jobs and $2.1B in wages
    - Governor Abbott's veto of SB 3 acknowledged Texans want regulation, not prohibition
    - The industry actively supports age restrictions and consumer safety
    - A ban would fuel black markets and destroy livelihoods
    
    **SENDER'S PROFILE:**
    - Works in Hemp Industry: ${profile.worksInHempIndustry ? "Yes - can reference direct impact" : "No"}
    - Location: ${userProfile.userLocation || 'Texas'}
    - Communication Style: ${tone.primaryTone || 'PROF_FORMAL'}
    - Has Personal Impact Story: ${profile.banImpactStatement ? "Yes" : "No"}
    
    **TONE GUIDANCE:**
    ${tone.primaryTone === 'POLICY_ANALYTICAL' ? '- Include economic/data angles' : ''}
    ${tone.primaryTone === 'PERSONAL_NARR' ? '- Make it personal and heartfelt' : ''}
    ${tone.primaryTone === 'CIVIC_PATRIOTIC' ? '- Appeal to Texas values and freedom' : ''}
    ${tone.primaryTone === 'SOLUTION_ORIENT' ? '- Focus on solutions and positive outcomes' : ''}
    ${tone.primaryTone === 'URGENT_RESPECT' ? '- Convey urgency and time-sensitivity' : ''}
    ${tone.primaryTone === 'BIPARTISAN' ? '- Appeal across party lines' : ''}
    ${tone.primaryTone === 'INSPIRATIONAL' ? '- Paint a hopeful vision' : ''}
    
    **INSTRUCTIONS:**
    - Generate exactly 5 subject lines
    - Each should be 50-80 characters max
    - Make them varied while matching the sender's communication style:
      • One emphasizing economic impact (jobs/tax revenue)
      • One focused on personal/community impact
      • One highlighting the regulation vs. prohibition choice
      • One appealing to Texas values/freedom
      • One with appropriate urgency for the special session
    ${profile.worksInHempIndustry ? '- At least one can reference "As a hemp industry worker"' : ''}
    ${userProfile.assignedDistricts ? '- One can reference constituent status for representatives' : ''}
    
    - Return as a JSON object with a "subjects" array
    
    Example format based on tone:
    {
      "subjects": [
        ${tone.primaryTone === 'POLICY_ANALYTICAL' ? '"53,000 Texas Jobs Depend on Smart Hemp Policy"' : '"Support Texas Jobs - Regulate, Don\'t Ban Hemp"'},
        ${profile.worksInHempIndustry ? '"Hemp Worker Asks: Choose Regulation Over Ban"' : '"Your Constituent Urges Smart Hemp Policy"'},
        "Common-Sense Hemp Rules Benefit All Texans",
        ${tone.primaryTone === 'CIVIC_PATRIOTIC' ? '"Protect Texas Freedom - Support Hemp Regulation"' : '"Urgent: Vote for Hemp Regulation, Not Prohibition"'},
        ${tone.primaryTone === 'PERSONAL_NARR' ? '"My Family Needs Hemp Access - Please Regulate"' : '"Texas Families Need Hemp Regulation, Not Bans"'}
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
  const profile = userProfile.intelligentDraftingProfile || {};
  const tone = profile.communicationTone || {};
  
  // Helper function for tone-specific guidance
  const getToneGuidance = (primaryTone) => {
    const toneGuides = {
      'POLICY_ANALYTICAL': 'Lead with data and economic analysis. Emphasize statistics and logical arguments.',
      'PERSONAL_NARR': 'Center personal story and human impact. Make it heartfelt and relatable.',
      'CIVIC_PATRIOTIC': 'Emphasize Texas values, freedom of choice, and civic responsibility.',
      'SOLUTION_ORIENT': 'Focus on specific regulatory solutions and constructive policy proposals.',
      'URGENT_RESPECT': 'Convey urgency while maintaining respect. Emphasize time-sensitive nature.',
      'FRIEND_PRO': 'Be warm but professional. Strike a balance between personable and business-appropriate.',
      'BIPARTISAN': 'Find common ground. Avoid partisan language and focus on shared values.',
      'INSPIRATIONAL': 'Paint a positive vision of what regulation could achieve for Texas.'
    };
    return toneGuides[primaryTone] || 'Maintain a professional and respectful tone throughout.';
  };
  
  const prompt = `
    Generate a compelling email to a Texas legislator advocating for hemp regulation over prohibition. The email must authentically represent the sender while effectively conveying the urgency and importance of this issue.

    **CRITICAL CONTEXT:**
    Texas stands at a pivotal moment for hemp policy. Governor Abbott's veto of SB 3 acknowledged that Texans want regulation, not prohibition. The stakes are high:
    - The hemp industry supports 53,000+ Texas jobs
    - Generates $2.1 billion in wages annually
    - Contributes $267 million in tax revenue to Texas
    - The industry has actively pushed for age restrictions for three legislative sessions
    - Industry leaders want robust consumer safety standards
    
    A ban would:
    - Destroy these jobs and economic benefits
    - Fuel a dangerous, unregulated black market
    - Eliminate responsible adults' access to wellness products they rely on
    - Ignore the will of Texans across the political spectrum

    **RECIPIENT INFORMATION:**
    - Name: ${formattedRepName}
    - Party: ${representative.party || 'Unknown'}
    - District: ${representative.district || 'Unknown'}
    ${representative.party === 'R' ? '- Consider: Economic freedom and limited government angles may resonate' : ''}
    ${representative.party === 'D' ? '- Consider: Worker protection and consumer safety angles may resonate' : ''}

    **SENDER PROFILE:**
    - Full Name: ${userProfile.userFullName}
    - EXACT Identity Descriptor: "${userDescriptor}"
    - Constituent Status: ${isConstituent ? 'IS a direct constituent of this representative' : 'NOT a constituent of this representative - do not claim to be'}
    - Industry Connection: ${profile.worksInHempIndustry ? `Works in hemp industry` : profile.occupation ? `Works as: ${profile.occupation}` : 'Not in hemp industry'}
    
    **COMMUNICATION STYLE:**
    - Primary Tone: ${tone.primaryTone || 'PROF_FORMAL'}
    - Tone Guidance: ${getToneGuidance(tone.primaryTone)}
    - Personality Elements: ${tone.personalityElements?.join(', ') || 'None specified'}
    ${tone.personalityElements?.includes('EMPATHETIC') ? '- Show understanding of different perspectives' : ''}
    ${tone.personalityElements?.includes('DATA_SAVVY') ? '- Incorporate compelling statistics naturally' : ''}
    ${tone.personalityElements?.includes('STORY_DRIVEN') ? '- Use vivid anecdotes to illustrate points' : ''}
    ${tone.personalityElements?.includes('COMMUNITY_VOICE') ? '- Reference broader community impact' : ''}

    **PERSONAL PERSPECTIVE TO INCORPORATE:**
    ${profile.banImpactStatement ? `- Personal Impact Statement: "${profile.banImpactStatement}"` : '- No personal impact statement provided'}
    ${profile.additionalComments ? `- Key Points to Convey: "${profile.additionalComments}"` : ''}
    ${profile.worksInHempIndustry ? '- May reference firsthand industry knowledge and experience' : ''}

    **POLICY POSITIONS TO REFLECT:**
    Regulations the sender SUPPORTS:
    ${profile.supportedRegulations?.length > 0 
      ? profile.supportedRegulations.map(r => `  ✓ ${r.regulation}${r.caveat ? ` (with caveat: ${r.caveat})` : ''}`).join('\n')
      : '  - General support for reasonable regulation'}
    
    Regulations the sender OPPOSES:
    ${profile.opposedRegulations?.length > 0 
      ? profile.opposedRegulations.map(r => `  ✗ ${r.regulation}${r.caveat ? ` (with caveat: ${r.caveat})` : ''}`).join('\n')
      : '  - No specific oppositions stated'}

    **EMAIL STRUCTURE FRAMEWORK:**
    1. Opening: Identify yourself using the EXACT identity descriptor provided
    2. Clear Position: Support common-sense regulation, not prohibition
    3. Context: Reference Governor Abbott's understanding and the will of Texans
    4. Impact Points: Weave in relevant statistics based on communication style
    5. Personal Perspective: Include if provided, making it authentic to their voice
    6. Policy Specifics: Emphasize regulations they support, acknowledge concerns about those they oppose
    7. Call to Action: Clear ask for support of balanced regulation

    **AUTHENTICITY REQUIREMENTS:**
    - You MUST use this exact phrasing in the introduction: "I am ${userDescriptor}"
    - NEVER claim the sender works in hemp industry unless explicitly stated they do
    - NEVER claim constituent status unless they are verified as a constituent
    - NEVER fabricate personal experiences or credentials
    - If they provided a personal impact statement, incorporate it naturally
    - Match the tone to their selected communication style

    **SUBJECT LINE GUIDANCE:**
    Create an attention-grabbing subject line (50-80 characters) that:
    ${tone.primaryTone === 'URGENT_RESPECT' ? '- Conveys urgency' : ''}
    ${tone.primaryTone === 'POLICY_ANALYTICAL' ? '- Highlights economic impact' : ''}
    ${tone.primaryTone === 'PERSONAL_NARR' ? '- Hints at personal stake' : ''}
    ${tone.primaryTone === 'CIVIC_PATRIOTIC' ? '- Appeals to Texas values' : ''}
    - Clearly indicates support for regulation over prohibition

    Generate the email with a compelling subject line and persuasive body that will move this legislator to support sensible hemp regulation. Return as a JSON object with "subject" and "body" fields.
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

// Export the zip code lookup functions
exports.getRepresentativesByZipCode = getRepresentativesByZipCode;
exports.getRepresentativesForMultipleZips = getRepresentativesForMultipleZips;
