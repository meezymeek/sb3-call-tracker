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

async function transformDistrictDataToZipBased() {
  console.log('Starting district data transformation and Firebase update...');
  
  try {
    // Read the new district-based JSON file
    const filePath = path.join(__dirname, 'tx_legislative_districts_by_zip.json');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const districtData = JSON.parse(fileContent);
    
    // Transform from district-based to zip-based structure
    const zipBasedData = {};
    let totalDistricts = 0;
    let totalZipMappings = 0;
    
    // Process house districts
    if (districtData.house_districts) {
      console.log('Processing House districts...');
      for (const [district, districtInfo] of Object.entries(districtData.house_districts)) {
        totalDistricts++;
        const rep = districtInfo.representative;
        const zipCodes = districtInfo.zip_codes || [];
        
        for (const zipCode of zipCodes) {
          if (!zipBasedData[zipCode]) {
            zipBasedData[zipCode] = { representatives: [] };
          }
          
          // Add house representative to this zip code
          zipBasedData[zipCode].representatives.push({
            type: 'Texas House',
            district: district,
            name: rep.representative_name || '',
            party: rep.party || '',
            email: rep.email || '',
            phone: rep.phone_number || ''
          });
          totalZipMappings++;
        }
      }
    }
    
    // Process senate districts
    if (districtData.senate_districts) {
      console.log('Processing Senate districts...');
      for (const [district, districtInfo] of Object.entries(districtData.senate_districts)) {
        totalDistricts++;
        const rep = districtInfo.representative;
        const zipCodes = districtInfo.zip_codes || [];
        
        for (const zipCode of zipCodes) {
          if (!zipBasedData[zipCode]) {
            zipBasedData[zipCode] = { representatives: [] };
          }
          
          // Add senate representative to this zip code
          zipBasedData[zipCode].representatives.push({
            type: 'Texas Senate',
            district: district,
            name: rep.representative_name || '',
            party: rep.party || '',
            email: rep.email || '',
            phone: rep.phone_number || ''
          });
          totalZipMappings++;
        }
      }
    }
    
    console.log(`Transformed ${totalDistricts} districts into ${Object.keys(zipBasedData).length} zip codes`);
    console.log(`Total zip-to-representative mappings: ${totalZipMappings}`);
    
    // Now update Firebase with merge logic
    await updateFirebaseWithMerge(zipBasedData);
    
  } catch (error) {
    console.error('❌ Error processing data:', error);
    process.exit(1);
  }
}

async function updateFirebaseWithMerge(zipBasedData) {
  console.log('\nStarting Firebase update with merge logic...');
  
  let batch = db.batch();
  let batchCount = 0;
  const maxBatchSize = 500;
  
  let newZipCodes = 0;
  let updatedZipCodes = 0;
  let skippedZipCodes = 0;
  
  const collectionRef = db.collection('texas_representatives');
  
  for (const [zipCode, newData] of Object.entries(zipBasedData)) {
    try {
      // Check if document exists
      const docRef = collectionRef.doc(zipCode);
      const doc = await docRef.get();
      
      if (doc.exists) {
        // Document exists - merge data
        const existingData = doc.data();
        const mergedReps = mergeRepresentatives(
          existingData.representatives || [],
          newData.representatives || []
        );
        
        // Only update if we actually added or updated data
        if (hasChanges(existingData.representatives || [], mergedReps)) {
          batch.update(docRef, {
            representatives: mergedReps,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: 'district_data_merge'
          });
          
          batchCount++;
          updatedZipCodes++;
          
          console.log(`Updated ${zipCode} with merged data`);
        } else {
          skippedZipCodes++;
        }
      } else {
        // Document doesn't exist - create it
        batch.set(docRef, {
          ...newData,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: 'district_data_import'
        });
        
        batchCount++;
        newZipCodes++;
        
        console.log(`Created new entry for ${zipCode}`);
      }
      
      // Commit batch if we reach the limit
      if (batchCount >= maxBatchSize) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount} documents`);
        // Create a new batch for the next set of operations
        batch = db.batch();
        batchCount = 0;
      }
      
    } catch (error) {
      console.error(`Error processing zip code ${zipCode}:`, error);
    }
  }
  
  // Commit any remaining documents
  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchCount} documents`);
  }
  
  // Update metadata
  await db.collection('texas_representatives_metadata').doc('district_update_info').set({
    lastUpdateDate: admin.firestore.FieldValue.serverTimestamp(),
    newZipCodes: newZipCodes,
    updatedZipCodes: updatedZipCodes,
    skippedZipCodes: skippedZipCodes,
    totalProcessed: Object.keys(zipBasedData).length,
    updateType: 'district_data_merge',
    sourceFile: 'tx_legislative_districts_by_zip.json'
  });
  
  console.log('\n✅ Update Summary:');
  console.log(`   - New zip codes added: ${newZipCodes}`);
  console.log(`   - Existing zip codes updated: ${updatedZipCodes}`);
  console.log(`   - Zip codes skipped (no changes): ${skippedZipCodes}`);
  console.log(`   - Total processed: ${Object.keys(zipBasedData).length}`);
}

function mergeRepresentatives(existingReps, newReps) {
  const merged = [...existingReps];
  
  for (const newRep of newReps) {
    // Find matching representative by type and district
    const existingIndex = existingReps.findIndex(
      r => r.type === newRep.type && r.district === newRep.district
    );
    
    if (existingIndex >= 0) {
      // Merge data - only fill in missing fields
      const existing = existingReps[existingIndex];
      merged[existingIndex] = {
        ...existing,
        name: existing.name || newRep.name,
        party: existing.party || newRep.party,
        email: existing.email || newRep.email,
        phone: existing.phone || newRep.phone,
        // Preserve any additional fields that might exist
        ...existing,
        // But ensure core fields are updated if they were empty
        ...(existing.name ? {} : { name: newRep.name }),
        ...(existing.party ? {} : { party: newRep.party }),
        ...(existing.email ? {} : { email: newRep.email }),
        ...(existing.phone ? {} : { phone: newRep.phone })
      };
    } else {
      // Add new representative
      merged.push(newRep);
    }
  }
  
  return merged;
}

function hasChanges(originalReps, mergedReps) {
  // Check if arrays are different lengths
  if (originalReps.length !== mergedReps.length) {
    return true;
  }
  
  // Check if any data has changed
  for (let i = 0; i < originalReps.length; i++) {
    const original = originalReps[i];
    const merged = mergedReps.find(
      r => r.type === original.type && r.district === original.district
    );
    
    if (!merged) return true;
    
    // Check if any fields were updated
    if (original.name !== merged.name ||
        original.party !== merged.party ||
        original.email !== merged.email ||
        original.phone !== merged.phone) {
      return true;
    }
  }
  
  return false;
}

// Run the update
transformDistrictDataToZipBased()
  .then(() => {
    console.log('\n🎉 District data merge completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Update process failed:', error);
    process.exit(1);
  });
