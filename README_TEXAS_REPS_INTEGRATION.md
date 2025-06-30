# Texas Representatives Integration Guide

This guide explains how to upload the texas_representatives.json file to Firebase Firestore and use the new zip code-based representative lookup functionality.

## Overview

The texas_representatives.json file contains a mapping of Texas zip codes to their corresponding representatives (House, Senate, and State Board of Education). This data is now integrated with Firebase Firestore for efficient lookups.

## Upload Process

### Prerequisites
- Node.js installed
- Firebase Admin SDK credentials (serviceAccountKey.json) in place
- Firebase project configured

### Step 1: Install Dependencies
```bash
npm install firebase-admin
```

### Step 2: Run the Upload Script
```bash
node upload_texas_reps_to_firestore.js
```

This script will:
- Read the texas_representatives.json file
- Upload each zip code as a separate document to Firestore
- Use batch processing for efficiency (max 500 documents per batch)
- Create a metadata document to track the upload

## Firestore Structure

### Collection: `zip_representatives`
Each document ID is a zip code (e.g., "75035") with the following structure:
```json
{
  "status": "success",
  "representatives": [
    {
      "name": "Senator Brent Hagenbuch",
      "district": "Texas Senate District 30",
      "type": "Texas Senate",
      "title": "Senator"
    },
    // ... more representatives
  ],
  "count": 4,
  "timestamp": "2025-06-30 12:06:09",
  "lastUpdated": "2025-06-30T19:21:00.000Z"
}
```

### Collection: `zip_representatives_metadata`
Contains metadata about the upload:
```json
{
  "lastUploadDate": "2025-06-30T19:21:00.000Z",
  "totalZipCodes": 1500,
  "uploadedBy": "admin_script",
  "sourceFile": "texas_representatives.json"
}
```

## Cloud Functions

Two new Cloud Functions are available for querying representatives:

### 1. `getRepresentativesByZipCode`
Query representatives for a single zip code:
```javascript
const functions = firebase.functions();
const result = await functions.httpsCallable('getRepresentativesByZipCode')({
  zipCode: '75035'
});

// Response:
{
  status: 'success',
  zipCode: '75035',
  representatives: [...],
  count: 4,
  timestamp: '2025-06-30 12:06:09',
  lastUpdated: '2025-06-30T19:21:00.000Z'
}
```

### 2. `getRepresentativesForMultipleZips`
Query representatives for multiple zip codes (max 10):
```javascript
const result = await functions.httpsCallable('getRepresentativesForMultipleZips')({
  zipCodes: ['75035', '75001', '78701']
});

// Response:
{
  results: {
    '75035': { status: 'success', representatives: [...] },
    '75001': { status: 'success', representatives: [...] },
    '78701': { status: 'success', representatives: [...] }
  },
  queriedCount: 3,
  timestamp: '2025-06-30T19:21:00.000Z'
}
```

## Frontend Integration

To use the zip code lookup in your frontend:

1. **Initialize Firebase Functions**:
```javascript
const functions = firebase.functions();
```

2. **Look up representatives by zip code**:
```javascript
async function lookupRepsByZip(zipCode) {
  try {
    const getRepsByZip = functions.httpsCallable('getRepresentativesByZipCode');
    const result = await getRepsByZip({ zipCode: zipCode });
    
    if (result.data.status === 'success') {
      console.log('Representatives found:', result.data.representatives);
      return result.data.representatives;
    } else {
      console.log('No representatives found for zip code:', zipCode);
      return [];
    }
  } catch (error) {
    console.error('Error looking up representatives:', error);
    return [];
  }
}
```

3. **Integrate with existing user profile**:
```javascript
// When user enters their zip code
const userZipCode = '75035'; // from user input
const representatives = await lookupRepsByZip(userZipCode);

// Now you can display these representatives or use them for email generation
```

## Benefits

1. **Accurate Representative Identification**: Users can find their exact representatives based on zip code
2. **Efficient Queries**: Only fetch data for specific zip codes, not the entire file
3. **Real-time Updates**: Can update representative data without redeploying the app
4. **Scalable**: Firestore handles large datasets efficiently
5. **Integrated with Email Generation**: The existing email generation functions can use this data

## Security

The Firestore rules are configured to:
- Allow all users to read zip_representatives data
- Require authentication to write/update data
- Same rules apply to the metadata collection

## Maintenance

To update the representatives data:
1. Update the texas_representatives.json file
2. Run the upload script again
3. The script will overwrite existing data with the new information

## Troubleshooting

If the upload fails:
- Check that serviceAccountKey.json exists and has correct permissions
- Ensure the Firebase project ID is correct
- Check the console for specific error messages
- Verify that Firestore is enabled in your Firebase project

## Next Steps

Consider implementing:
1. A frontend component for zip code lookup
2. Caching of frequently accessed zip codes
3. Analytics to track which zip codes are most queried
4. Admin dashboard section to manually update representative data
