const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://sb3calltool-default-rtdb.firebaseio.com"
  });
}

const db = admin.firestore();

async function uploadTexasRepsData() {
  console.log('Starting Texas Representatives data upload to Firestore...');
  
  try {
    // Read the texas_representatives.json file
    const filePath = path.join(__dirname, 'texas_representatives.json');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(fileContent);
    
    // Create a batch for efficient writes
    const batch = db.batch();
    let batchCount = 0;
    const maxBatchSize = 500; // Firestore limit
    
    // Track progress
    const totalZipCodes = Object.keys(data).length;
    let processedCount = 0;
    
    console.log(`Total zip codes to process: ${totalZipCodes}`);
    
    // Process each zip code
    for (const [zipCode, zipData] of Object.entries(data)) {
      const docRef = db.collection('zip_representatives').doc(zipCode);
      
      // Add to batch
      batch.set(docRef, {
        ...zipData,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      batchCount++;
      processedCount++;
      
      // Commit batch if we reach the limit
      if (batchCount >= maxBatchSize) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount} documents. Progress: ${processedCount}/${totalZipCodes}`);
        
        // Create new batch
        batchCount = 0;
      }
    }
    
    // Commit any remaining documents
    if (batchCount > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${batchCount} documents. Progress: ${processedCount}/${totalZipCodes}`);
    }
    
    // Create a metadata document to track the upload
    await db.collection('zip_representatives_metadata').doc('upload_info').set({
      lastUploadDate: admin.firestore.FieldValue.serverTimestamp(),
      totalZipCodes: totalZipCodes,
      uploadedBy: 'admin_script',
      sourceFile: 'texas_representatives.json'
    });
    
    console.log(`✅ Successfully uploaded ${processedCount} zip codes to Firestore!`);
    console.log('Metadata document created.');
    
  } catch (error) {
    console.error('❌ Error uploading data:', error);
    process.exit(1);
  }
}

// Run the upload
uploadTexasRepsData()
  .then(() => {
    console.log('Upload process completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Upload process failed:', error);
    process.exit(1);
  });
