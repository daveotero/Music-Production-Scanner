import { log } from './utils.js';

const EXPECTED_HEADERS = ['Artist','Album Title','Label','Year','Credits','Artwork URL','Discogs URL'];
const RELEASE_KEYS = ['artist','title','label','year','credits','artwork','discogsUrl'];
// The unescapeCsvField function is no longer needed as its logic is integrated into the new parseCSVRow

function parseCSVRow(rowString) {
  const fields = [];
  let inQuotes = false;
  let fieldBuffer = '';

  for (let i = 0; i < rowString.length; i++) {
    const char = rowString[i];

    if (char === '"') {
      if (inQuotes && i + 1 < rowString.length && rowString[i+1] === '"') {
        // This is an escaped quote "" within a quoted field
        fieldBuffer += '"';
        i++; // Skip the second quote of the pair
      } else {
        // This is a start or end quote for a field
        inQuotes = !inQuotes;
        // Do not add the delimiting quote to the fieldBuffer
      }
    } else if (char === ',' && !inQuotes) {
      // This is a comma delimiter outside of any quotes
      fields.push(fieldBuffer);
      fieldBuffer = '';
    } else {
      // Any other character
      fieldBuffer += char;
    }
  }
  fields.push(fieldBuffer); // Add the last field
  return fields;
}

function parseCSVContent(csvString) {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { success: false, data: null, message: 'CSV file must contain a header row and at least one data row.' };
  }

  const headerLine = lines.shift();
  const actualHeaders = parseCSVRow(headerLine);
  if (actualHeaders.length !== EXPECTED_HEADERS.length || !actualHeaders.every((h, i) => h === EXPECTED_HEADERS[i])) {
    const message = `CSV Import Error: Headers do not match expected format. Expected: "${EXPECTED_HEADERS.join(', ')}". Found: "${actualHeaders.join(', ')}"`;
    log(message, 'error');
    return { success: false, data: null, message: 'File headers do not match the expected format. Please ensure the CSV was exported from this application or matches its structure.' };
  }

  const importedReleases = lines.map((line, index) => {
    if (line.trim() === '') return null; // Skip empty lines
    const values = parseCSVRow(line);
    if (values.length !== RELEASE_KEYS.length) {
      log(`CSV Import Warning: Row ${index + 2} (data row ${index + 1}) has an incorrect number of columns after parsing. Expected ${RELEASE_KEYS.length}, found ${values.length}. Skipping row. Line: ${line}`, 'warning');
      return null; // Skip malformed rows
    }
    const release = {};
    RELEASE_KEYS.forEach((key, i) => {
      release[key] = values[i] || '';
    });
    // Convert year to number if possible, otherwise keep as string
    if (release.year) {
      const yearNum = parseInt(release.year, 10);
      release.year = isNaN(yearNum) ? release.year : yearNum;
    }
    return release;
  }).filter(Boolean); // Remove nulls from skipped lines

  return { success: true, data: importedReleases, message: `${importedReleases.length} items parsed from CSV.` };
}

export async function handleCSVFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ success: false, data: null, message: 'No file selected.' });
      return;
    }

    if (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const parseResult = parseCSVContent(e.target.result);
        resolve(parseResult);
      };
      reader.onerror = () => {
        const errorMessage = `Error reading file: ${reader.error}`;
        log(errorMessage, 'error');
        resolve({ success: false, data: null, message: 'Error reading the selected file.' });
      };
      reader.readAsText(file);
    } else {
      log('Invalid file type selected for import. Must be CSV.', 'warning');
      resolve({ success: false, data: null, message: 'Please select a valid CSV file.' });
    }
  });
}