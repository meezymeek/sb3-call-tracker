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

async function uploadContactLists() {
  console.log('Starting contact lists upload to Firestore...');
  
  try {
    // Read the manifest file
    const manifestPath = path.join(__dirname, 'contacts', 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    
    console.log(`Found ${manifest.contact_lists.length} contact lists to upload`);
    
    // Process each contact list
    for (const filename of manifest.contact_lists) {
      // Extract the list identifier from filename (e.g., "0_Committee_Public_Health.json" -> "0_Committee_Public_Health")
      const listId = filename.replace('.json', '');
      
      // Read the contact list file
      const filePath = path.join(__dirname, 'contacts', filename);
      const fileContent = await fs.readFile(filePath, 'utf8');
      const reps = JSON.parse(fileContent);
      
      console.log(`Uploading ${listId} with ${reps.length} representatives...`);
      
      // Upload to Firestore
      await db.collection('contact_lists').doc(listId).set({
        reps: reps,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        repCount: reps.length
      });
      
      console.log(`✅ Successfully uploaded ${listId}`);
    }
    
    // Update metadata
    await db.collection('contact_lists_metadata').doc('upload_info').set({
      lastUploadDate: admin.firestore.FieldValue.serverTimestamp(),
      totalLists: manifest.contact_lists.length,
      uploadedBy: 'admin_script',
      lists: manifest.contact_lists
    });
    
    console.log('\n✅ All contact lists uploaded successfully!');
    
  } catch (error) {
    console.error('❌ Error uploading contact lists:', error);
    process.exit(1);
  }
}

// Run the upload
uploadContactLists()
  .then(() => {
    console.log('Upload process completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Upload process failed:', error);
    process.exit(1);
  });
