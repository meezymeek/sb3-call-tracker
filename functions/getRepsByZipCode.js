const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Ensure admin is initialized (this will already be done in index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.getRepresentativesByZipCode = onCall(async (request) => {
  const {zipCode} = request.data;

  // Validate input
  if (!zipCode) {
    throw new HttpsError("invalid-argument", "Zip code is required");
  }

  // Validate zip code format (5 digits)
  const zipCodeRegex = /^\d{5}$/;
  if (!zipCodeRegex.test(zipCode)) {
    throw new HttpsError("invalid-argument", "Invalid zip code format. Must be 5 digits.");
  }

  try {
    // Query Firestore for the zip code
    const db = admin.firestore();
    const docRef = db.collection("zip_representatives").doc(zipCode);
    const doc = await docRef.get();

    if (!doc.exists) {
      return {
        status: "not_found",
        message: `No representatives found for zip code ${zipCode}`,
        representatives: [],
      };
    }

    const data = doc.data();

    // Return the representatives data
    return {
      status: data.status || "success",
      zipCode: zipCode,
      representatives: data.representatives || [],
      count: data.count || 0,
      timestamp: data.timestamp || null,
      lastUpdated: data.lastUpdated ? data.lastUpdated.toDate().toISOString() : null,
    };
  } catch (error) {
    console.error("Error fetching representatives:", error);
    throw new HttpsError("internal", "Failed to fetch representatives data");
  }
});

// Function to get representatives for multiple zip codes (batch query)
exports.getRepresentativesForMultipleZips = onCall(async (request) => {
  const {zipCodes} = request.data;

  // Validate input
  if (!zipCodes || !Array.isArray(zipCodes)) {
    throw new HttpsError("invalid-argument", "zipCodes must be an array");
  }

  if (zipCodes.length === 0) {
    throw new HttpsError("invalid-argument", "At least one zip code is required");
  }

  if (zipCodes.length > 10) {
    throw new HttpsError("invalid-argument", "Maximum 10 zip codes can be queried at once");
  }

  // Validate each zip code
  const zipCodeRegex = /^\d{5}$/;
  for (const zip of zipCodes) {
    if (!zipCodeRegex.test(zip)) {
      throw new HttpsError("invalid-argument", `Invalid zip code format: ${zip}`);
    }
  }

  try {
    const db = admin.firestore();
    const results = {};

    // Fetch all documents in parallel
    const promises = zipCodes.map(async (zipCode) => {
      const docRef = db.collection("zip_representatives").doc(zipCode);
      const doc = await docRef.get();

      if (doc.exists) {
        const data = doc.data();
        results[zipCode] = {
          status: data.status || "success",
          representatives: data.representatives || [],
          count: data.count || 0,
          timestamp: data.timestamp || null,
          lastUpdated: data.lastUpdated ? data.lastUpdated.toDate().toISOString() : null,
        };
      } else {
        results[zipCode] = {
          status: "not_found",
          message: `No representatives found for zip code ${zipCode}`,
          representatives: [],
        };
      }
    });

    await Promise.all(promises);

    return {
      results: results,
      queriedCount: zipCodes.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching representatives for multiple zips:", error);
    throw new HttpsError("internal", "Failed to fetch representatives data");
  }
});
