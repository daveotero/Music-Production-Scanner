// modules/apiService.js
import { state } from './state.js';
import { DISCOGS_BASE_URL } from './constants.js';
import { elements } from './domElements.js';
import { log, delay } from './utils.js';

export async function fetchArtistDetails(artistId) {
    if (!artistId) return null;
    if (!state.discogsToken) {
        log('Discogs token not set. Fetching artist details unauthenticated.', 'info');
    }
    const url = `${DISCOGS_BASE_URL}/artists/${artistId}`;
    try {
        // Using a lower maxRetries for artist details as it's usually a quick one-off
        const data = await fetchWithRetry(url, {}, 2);
        return data;
    } catch (error) {
        log(`Failed to fetch artist details for ID ${artistId}: ${error.message}`, 'error');
        return null;
    }
}

export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  if (state.isScanManuallyStopped) throw new Error('Scan manually stopped during fetchWithRetry');
  const headers = {
    'User-Agent': 'MusicProductionScanner/1.4 (+YOUR_CONTACT_INFO_OR_PROJECT_URL)', // Remember to update or make this configurable
    ...options.headers
  };
  if (state.discogsToken) {
    headers['Authorization'] = `Discogs token=${state.discogsToken}`;
  }

  const fetchOptions = { ...options, headers };
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (state.isScanManuallyStopped) throw new Error('Scan manually stopped during retry loop for ' + url);
    try {
      if (attempt > 0) log(`Retry attempt ${attempt + 1}/${maxRetries} for ${url.substring(0, 80)}...`);
      const response = await fetch(url, fetchOptions);
      if (state.isScanManuallyStopped) throw new Error('Scan manually stopped after fetch response for ' + url);

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        let waitTimeSeconds = retryAfterHeader ? parseInt(retryAfterHeader) : (2 ** attempt) * 5 + Math.floor(Math.random() * 5);
        waitTimeSeconds = Math.min(waitTimeSeconds, 60); // Cap wait time
        log(`Rate limited (429). Waiting ${waitTimeSeconds}s before retry for ${url.substring(0, 80)}...`, 'warning');
        if (elements.throttleWarning) elements.throttleWarning.classList.remove('d-none');
        await delay(waitTimeSeconds * 1000);
        if (elements.throttleWarning) elements.throttleWarning.classList.add('d-none');
        if (state.isScanManuallyStopped) throw new Error('Scan manually stopped during 429 delay for ' + url);
        continue;
      }
      if (!response.ok) {
        const errorText = await response.text();
        const displayError = errorText.length > 200 ? errorText.substring(0, 200) + "..." : errorText;
        throw new Error(`HTTP error ${response.status}: ${displayError}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.message.startsWith('Scan manually stopped')) throw error; // Propagate manual stop immediately

      // For specific client errors like 401, 403, 404, don't retry endlessly
      if (error.message.includes('HTTP error 401') || error.message.includes('HTTP error 403') || error.message.includes('HTTP error 404')) {
        log(`Unrecoverable client error for ${url.substring(0,80)}: ${error.message}. Not retrying this attempt.`, 'error');
        throw error;
      }

      // Exponential backoff with jitter for other errors
      const backoffSeconds = Math.min((2 ** attempt) * 2, 30); // Cap backoff
      const jitter = Math.random() * 1000; // Add jitter
      const waitTime = (backoffSeconds * 1000) + jitter;

      if (attempt < maxRetries - 1) {
        log(`Fetch error for ${url.substring(0,80)}: ${error.message.substring(0,100)}. Retrying in ${Math.round(waitTime/1000)}s`, 'warning');
      }
      await delay(waitTime);
      if (state.isScanManuallyStopped) throw new Error('Scan manually stopped during error backoff delay for ' + url);
    }
  }
  log(`Failed to fetch ${url.substring(0,80)}... after ${maxRetries} attempts. Last error: ${lastError.message}`, 'error');
  throw lastError;
}