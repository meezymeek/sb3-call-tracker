# District Data Update Script

This script updates your Firebase database with district-to-zip-code mapping data while preserving existing information.

## What it does

1. **Reads** `tx_legislative_districts_by_zip.json` which contains district-based data
2. **Transforms** the data from district-based to zip-based format (matching your current Firebase structure)
3. **Merges** with existing Firebase data:
   - Creates new documents for zip codes that don't exist
   - Updates existing documents by filling in missing representative information
   - Never overwrites existing data that's already populated
   - Adds representatives that are missing from zip codes

## How it works

### Merge Logic
- For existing zip codes: Only fills in empty fields (name, party, email, phone)
- For new zip codes: Creates complete entries
- Preserves all existing data and relationships
- Matches representatives by type (House/Senate) and district number

### Data Structure
The script expects your `tx_legislative_districts_by_zip.json` to have this format:
```json
{
  "house_districts": {
    "1": {
      "representative": {
        "representative_name": "Name Here",
        "phone_number": "",
        "party": "",
        "email": ""
      },
      "zip_codes": ["75555", "75558", ...]
    }
  },
  "senate_districts": {
    // Similar structure
  }
}
```

## How to run

1. Make sure `tx_legislative_districts_by_zip.json` is in the project root
2. Ensure `serviceAccountKey.json` is present
3. Run the script:
   ```bash
   node update_firebase_with_district_data.js
   ```

## Output

The script will:
- Show progress as it processes districts
- Display which zip codes are created, updated, or skipped
- Create a metadata document with update statistics
- Report a final summary

## Safety Features

- Uses batch operations for efficiency
- Only updates when there are actual changes
- Preserves all existing data
- Creates detailed logs of what was changed
- Updates metadata for tracking

## Example Output
```
Starting district data transformation and Firebase update...
Processing House districts...
Processing Senate districts...
Transformed 181 districts into 1671 zip codes
Total zip-to-representative mappings: 3342

Starting Firebase update with merge logic...
Updated 78701 with merged data
Created new entry for 78702
...

✅ Update Summary:
   - New zip codes added: 245
   - Existing zip codes updated: 892
   - Zip codes skipped (no changes): 534
   - Total processed: 1671
