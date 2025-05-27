// app.js - Music Production Scanner v8
// - Parses Artist ID input like [a12345]
// - Fetches Key Release for masters.
// - Conditionally fetches additional versions ONLY if Key Release lacks target artist credits.
// - Aims for a deduplicated list for the user.
// - Dynamic rate limiting based on token presence.
// - In-page modal for artwork.

import { CACHE_KEYS, DISCOGS_BASE_URL, TOKEN_PRESENT_DELAY_MS, NO_TOKEN_DELAY_MS, MAX_ADDITIONAL_VERSIONS_FOR_CREDITS, APP_VERSION } from './modules/constants.js';
import { elements } from './modules/domElements.js';
import { state, updateTargetArtistNameVariants } from './modules/state.js';
import { log, escapeHtml, delay, generateNameVariants, getArtistCacheKey } from './modules/utils.js';
import { fetchArtistDetails, fetchWithRetry } from './modules/apiService.js';
import { runScanCycle, retrySingleItem as scanServiceRetrySingleItem } from './modules/scanService.js';
import { handleCSVFile } from './modules/importService.js';


// DOM elements

// State management

// --- Initialization and Settings Management ---

function setRequestDelay() {
    if (state.discogsToken && state.discogsToken.trim() !== '') {
        state.requestDelayMs = TOKEN_PRESENT_DELAY_MS;
        log(`Discogs token found. Request delay set to ${state.requestDelayMs}ms.`, 'info');
    } else {
        state.requestDelayMs = NO_TOKEN_DELAY_MS;
        log(`No Discogs token. Request delay set to ${state.requestDelayMs}ms (slower).`, 'info');
    }
}

async function loadUserSettings() {
  const settings = await localforage.getItem(CACHE_KEYS.USER_SETTINGS);
  if (settings) {
    if (settings.artistId && elements.artistIdInput) {
        elements.artistIdInput.value = settings.artistId;
        state.currentArtistId = settings.artistId;
    }
    if (settings.token && elements.discogsTokenInput) {
        elements.discogsTokenInput.value = settings.token;
        state.discogsToken = settings.token;
    } else {
        state.discogsToken = null;
    }
    setRequestDelay();

    if (settings.artistName) {
        state.currentArtistName = settings.artistName;
        updateMainHeading(settings.artistName);
        updateTargetArtistNameVariants(generateNameVariants(settings.artistName));
    }
    log('Loaded user settings from cache.');
  } else {
    log('No user settings found in cache. Please enter Artist ID and Token.');
    setRequestDelay();
  }
}

async function saveUserSettings() {
  let rawArtistIdInput = elements.artistIdInput ? elements.artistIdInput.value.trim() : null;
  const token = elements.discogsTokenInput ? elements.discogsTokenInput.value.trim() : null;
  let parsedArtistId = rawArtistIdInput;

  if (rawArtistIdInput) {
    const match = rawArtistIdInput.match(/^\[a(\d+)\]$/);
    if (match && match[1]) {
      parsedArtistId = match[1];
      log(`Parsed artist ID from input "${rawArtistIdInput}" to "${parsedArtistId}".`);
    } else if (!/^\d+$/.test(rawArtistIdInput)) {
        log(`Invalid Artist ID format: "${rawArtistIdInput}". Please use a numeric ID or [a<ID>].`, 'warning');
        alert('Invalid Artist ID format. Please use a numeric ID (e.g., 12345) or the format [a12345].');
        return;
    }
  }

  if (!parsedArtistId) {
    log('Artist ID is required to save settings.', 'warning');
    alert('Please enter a Discogs Artist ID.');
    return;
  }

  state.currentArtistId = parsedArtistId;
  state.discogsToken = token;
  setRequestDelay();

  if (elements.artistIdInput) {
      elements.artistIdInput.value = parsedArtistId;
  }

  if (parsedArtistId) {
      try {
          const artistData = await fetchArtistDetails(parsedArtistId);
          if (artistData && artistData.name) {
              state.currentArtistName = artistData.name;
              updateMainHeading(artistData.name);
              updateTargetArtistNameVariants(generateNameVariants(artistData.name));
              await localforage.setItem(CACHE_KEYS.USER_SETTINGS, {
                  artistId: state.currentArtistId,
                  token: state.discogsToken,
                  artistName: state.currentArtistName
              });
              log(`Settings saved for Artist: ${state.currentArtistName} (ID: ${state.currentArtistId}). Ready to scan.`);
              await loadCachedDataForCurrentArtist();
          } else {
              log('Could not fetch artist name. Settings saved with ID only.', 'warning');
              state.currentArtistName = null;
              updateMainHeading();
              updateTargetArtistNameVariants([]);
              await localforage.setItem(CACHE_KEYS.USER_SETTINGS, { artistId: state.currentArtistId, token: state.discogsToken, artistName: null });
          }
      } catch (error) {
          log(`Error fetching artist details for settings: ${error.message}`, 'error');
          state.currentArtistName = null;
          updateMainHeading();
          updateTargetArtistNameVariants([]);
          await localforage.setItem(CACHE_KEYS.USER_SETTINGS, { artistId: state.currentArtistId, token: state.discogsToken, artistName: null });
      }
  }
}

function updateMainHeading(artistName = null) {
    const artistNameDisplayElement = document.getElementById('artistNameBesideId');

    if (elements.mainHeading) {
        if (artistName && state.currentArtistId) {
            elements.mainHeading.innerHTML =
                `<a href="https://www.discogs.com/artist/${state.currentArtistId}" target="_blank" rel="noopener noreferrer" title="View ${escapeHtml(artistName)} on Discogs">${escapeHtml(artistName)}</a> Production Scanner`;
        } else if (artistName) {
            elements.mainHeading.textContent = `${artistName} Production Scanner`;
        } else {
            elements.mainHeading.textContent = 'Music Production Scanner';
        }
    }

    if (artistNameDisplayElement) {
        if (artistName && state.currentArtistId) {
            artistNameDisplayElement.innerHTML =
                `(<a href="https://www.discogs.com/artist/${state.currentArtistId}" target="_blank" rel="noopener noreferrer" title="View ${escapeHtml(artistName)} on Discogs">${escapeHtml(artistName)}</a>)`;
        } else if (state.currentArtistId && !artistName) { // ID exists, but name doesn't (e.g. fetch failed or cleared)
            artistNameDisplayElement.textContent = '(Name not available)';
        } else { // No artist ID, or explicitly clearing
            artistNameDisplayElement.innerHTML = '';
        }
    }
}

async function init() {
  checkOfflineStatus();
  addEventListeners();
  await loadUserSettings();

  if (elements.logContentCollapse && elements.logContentCollapse.classList.contains('show')) {
    state.logVisible = true;
    if (elements.toggleLogText) elements.toggleLogText.textContent = 'Hide';
  } else {
    state.logVisible = false;
    if (elements.toggleLogText) elements.toggleLogText.textContent = 'Show';
  }

  if (elements.errorContent && elements.errorContent.classList.contains('show')) {
    state.errorsVisible = true;
    if (elements.toggleErrorsText) elements.toggleErrorsText.textContent = 'Hide';
  } else {
    state.errorsVisible = false;
    if (elements.toggleErrorsText) elements.toggleErrorsText.textContent = 'Show';
  }
  // Initialize settings panel toggle text
  if (elements.settingsContentCollapse && elements.settingsContentCollapse.classList.contains('show')) {
    // state.settingsVisible = true; // Optional: if you want to track visibility in state
    if (elements.toggleSettingsText) elements.toggleSettingsText.textContent = 'Hide';
  } else {
    // state.settingsVisible = false; // Optional
    if (elements.toggleSettingsText) elements.toggleSettingsText.textContent = 'Show';
  }

  if (state.currentArtistId) {
    await loadCachedDataForCurrentArtist();
  } else {
    // Display version even if no artist is loaded
    const appVersionDisplayElement = document.getElementById('appVersionDisplay');
    if (appVersionDisplayElement) {
        appVersionDisplayElement.textContent = `v${APP_VERSION}`;
    }
    log('Please enter a Discogs Artist ID and your Discogs Token, then click "Save Settings".');
    if(elements.noDataRow) elements.noDataRow.classList.remove('d-none');
  }
}

// --- Artwork Modal Logic ---
function openArtworkModal(imageUrl, captionText) {
    if (elements.artworkModal && elements.modalImage && elements.modalCaption) {
        elements.modalImage.src = imageUrl;
        elements.modalImage.alt = captionText;
        elements.modalCaption.textContent = captionText;
        elements.artworkModal.style.display = "block";
        document.body.classList.add('modal-open');
        state.isModalOpen = true;
        document.addEventListener('keydown', handleModalKeydown);
    } else {
        log('Artwork modal elements not found in the DOM. Ensure artworkModal, modalImage, and modalCaption IDs exist.', 'error');
    }
}

function closeArtworkModal() {
    if (elements.artworkModal) {
        elements.artworkModal.style.display = "none";
        document.body.classList.remove('modal-open');
        state.isModalOpen = false;
        document.removeEventListener('keydown', handleModalKeydown);
    }
}

function handleModalKeydown(event) {
    if (event.key === 'Escape' && state.isModalOpen) {
        closeArtworkModal();
    }
}


// --- Data Fetching and Processing ---

async function startFullScan() {
  if (!state.currentArtistId) {
    alert('Please enter a Discogs Artist ID and click "Save Settings" first.');
    log('Scan aborted: Artist ID not set.', 'error');
    return;
  }
  if (!state.discogsToken) {
    log('Warning: Discogs Token not set. Scan will proceed with slower rate limits.', 'warning');
     if (!confirm(`Discogs Token is not set. This will use a slower request rate (${NO_TOKEN_DELAY_MS / 1000}s per request). Continue anyway?`)) {
        log('Scan cancelled by user due to missing token preference.');
        return;
    }
  } else {
    log(`Using request delay of ${state.requestDelayMs / 1000}s with token.`, 'info');
  }

  if (state.isLoading) {
    log('Scan is already in progress.', 'warning');
    return;
  }
  state.isLoading = true;
  state.isScanManuallyStopped = false;

  if (elements.stopScanBtn) {
    elements.stopScanBtn.classList.remove('d-none');
    elements.stopScanBtn.disabled = false;
    elements.stopScanBtn.textContent = 'Stop Scan';
  }
  updateLoadingState(true, `Scanning for ${state.currentArtistName || `Artist ID ${state.currentArtistId}`}...`);

  try {
    // runScanCycle will internally handle retrying failed items if any,
    // and then proceed to fetch new items.
    // It should be called as long as the scan hasn't been manually stopped initially.
    if (!state.isScanManuallyStopped) {
      await runScanCycle();
    }
    if (state.isScanManuallyStopped) {
      log('Scan process was manually stopped by user.', 'warning');
      await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);
      await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);
      renderReleases();
      updateErrorPanel();
    } else {
      log('Scan process completed.');
    }
  } catch (error) {
    log(`Critical error during scan process: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    if (elements.stopScanBtn) {
      elements.stopScanBtn.classList.add('d-none');
      elements.stopScanBtn.disabled = false;
      elements.stopScanBtn.textContent = 'Stop Scan';
    }
    updateLoadingState(false);
  }
}

async function loadCachedDataForCurrentArtist() {
  if (!state.currentArtistId) {
    log('Cannot load cached data: Artist ID not set.', 'info');
    state.releases = []; state.failedQueue = []; state.lastUpdated = null;
    renderReleases(); updateErrorPanel(); updateLastUpdatedText();
    return;
  }
  // Display version when loading cached data as well
  const appVersionDisplayElement = document.getElementById('appVersionDisplay');
  if (appVersionDisplayElement) {
      appVersionDisplayElement.textContent = `v${APP_VERSION}`;
  }
  try {
    const [releases, lastUpdated, failedQueue] = await Promise.all([
      localforage.getItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX)),
      localforage.getItem(getArtistCacheKey(CACHE_KEYS.LAST_UPDATED_PREFIX)),
      localforage.getItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX))
    ]);
    state.releases = releases || [];
    state.lastUpdated = lastUpdated || null;
    state.failedQueue = failedQueue || [];
    updateLastUpdatedText(); renderReleases(); updateErrorPanel();
    log(`Loaded ${state.releases.length} items from cache for Artist ID: ${state.currentArtistId}.`);
    if (state.failedQueue.length > 0) {
      log(`Found ${state.failedQueue.length} failed items in queue for this artist.`);
    }
     if (state.releases.length === 0 && state.failedQueue.length === 0) {
        if(elements.noDataRow) elements.noDataRow.textContent = `No cached data for ${state.currentArtistName || `Artist ID ${state.currentArtistId}`}. Click "Start Scan".`;
    }
  } catch (error) {
    log(`Error loading cached data for Artist ID ${state.currentArtistId}: ${error.message}`, 'error');
  }
}

function exportCSV() {
  if (state.releases.length === 0) {
    alert('No data to export'); return;
  }
  try {
    const artistPart = state.currentArtistName ? state.currentArtistName.replace(/\s+/g, '_') : (state.currentArtistId || 'unknown_artist');
    const filename = `${artistPart}_production_credits.csv`;
    log(`Exporting ${state.releases.length} items to ${filename}`);
    const escapeField = (field) => `"${String(field == null ? '' : field).replace(/"/g, '""')}"`;
    const headers = ['Artist', 'Album Title', 'Label', 'Year', 'Credits', 'Artwork URL', 'Discogs URL'];
    let csv = headers.map(escapeField).join(',') + '\n';

    const sortedReleasesForExport = [...state.releases].sort((a, b) => {
        const aValue = a[state.sortColumn]; const bValue = b[state.sortColumn];
        if (state.sortColumn === 'year') {
            const aNum = parseInt(aValue) || 0; const bNum = parseInt(bValue) || 0;
            return state.sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }
        const strA = String(aValue || '').toLowerCase(); const strB = String(bValue || '').toLowerCase();
        if (strA < strB) return state.sortDirection === 'asc' ? -1 : 1;
        if (strA > strB) return state.sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    for (const release of sortedReleasesForExport) {
      const row = [
        release.artist, release.title, release.label, release.year, release.credits,
        release.artwork, release.discogsUrl
      ];
      csv += row.map(escapeField).join(',') + '\n';
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url); link.setAttribute('download', filename);
    link.style.display = 'none'; document.body.appendChild(link);
    link.click(); document.body.removeChild(link);
    log(`Exported ${state.releases.length} items to CSV`);
  } catch (error) {
    log(`Error exporting CSV: ${error.message}`, 'error');
  }
}

async function clearCurrentArtistCache() {
  if (!state.currentArtistId) {
    alert("No artist selected to clear cache for."); return;
  }
  if (confirm(`Are you sure you want to clear all cached data for ${state.currentArtistName || `Artist ID ${state.currentArtistId}`}? This cannot be undone.`)) {
    log(`Clearing cached data for Artist ID: ${state.currentArtistId}`);
    try {
      await Promise.all([
        localforage.removeItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX)),
        localforage.removeItem(getArtistCacheKey(CACHE_KEYS.LAST_UPDATED_PREFIX)),
        localforage.removeItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX))
      ]);
      log('Cache cleared for current artist. Reloading data (which will be empty).');
      state.releases = []; state.failedQueue = []; state.lastUpdated = null;
      renderReleases(); updateErrorPanel(); updateLastUpdatedText();
      updateMainHeading(null); // Reset heading and artist name display
      if(elements.noDataRow) elements.noDataRow.textContent = `Cache cleared for ${state.currentArtistName || `Artist ID ${state.currentArtistId}`}. Click "Start Scan".`;
    } catch (error) {
      log(`Error clearing cache for current artist: ${error.message}`, 'error');
    }
  }
}

// --- CSV Import Application Logic ---
async function processImportedDataAndUpdateUI(importedReleases, artistNameToConfirm) {
  state.releases = importedReleases;
  state.failedQueue = []; // Clear failed queue as imported data is the new truth
  state.lastUpdated = Date.now();

  await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);
  await localforage.setItem(getArtistCacheKey(CACHE_KEYS.LAST_UPDATED_PREFIX), state.lastUpdated);
  await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);

  renderReleases();
  updateLastUpdatedText();
  updateErrorPanel();
  log(`${importedReleases.length} items successfully imported and cached for ${artistNameToConfirm}.`, 'info');
  alert(`${importedReleases.length} items imported successfully.`);
}

async function handleFileSelectForImport(event) {
  const file = event.target.files[0];
  if (file) {
    if (!state.currentArtistId) {
      alert('Please save settings for an artist before importing a CSV.');
      log('CSV import aborted: No current artist ID set.', 'warning');
      event.target.value = null; // Reset file input
      return;
    }

    const artistNameToConfirm = state.currentArtistName || `Artist ID ${state.currentArtistId}`;
    if (!confirm(`This will replace all currently displayed data and cached data for artist '${artistNameToConfirm}' with the content of the selected CSV file. This action cannot be undone. Proceed?`)) {
      log('CSV import cancelled by user.', 'info');
      event.target.value = null; // Reset file input
      return;
    }

    const result = await handleCSVFile(file); // Call the function from importService

    if (result.success) {
      await processImportedDataAndUpdateUI(result.data, artistNameToConfirm);
    } else {
      alert(`CSV Import Failed: ${result.message}`);
      log(`CSV Import Failed: ${result.message}`, 'error');
    }
    // Reset file input value to allow re-importing the same file if needed
    event.target.value = null;
  }
}

// --- UI Rendering and Updates ---
export function renderReleases() {
  if (!elements.gridBody) return;
  if (state.releases.length === 0) {
    if (elements.noDataRow) {
        elements.noDataRow.classList.remove('d-none');
        elements.noDataRow.textContent = state.currentArtistId ? `No items found or cached for ${state.currentArtistName || `Artist ID ${state.currentArtistId}`}.` : 'Enter Artist ID & Token, then click "Save Settings" and "Start Scan".';
    }
    elements.gridBody.innerHTML = ''; return;
  }
  if (elements.noDataRow) elements.noDataRow.classList.add('d-none');

  const sortedReleases = [...state.releases].sort((a, b) => {
    const aValue = a[state.sortColumn]; const bValue = b[state.sortColumn];
    if (state.sortColumn === 'year') {
      const aNum = parseInt(aValue) || (state.sortDirection === 'asc' ? Infinity : -Infinity);
      const bNum = parseInt(bValue) || (state.sortDirection === 'asc' ? Infinity : -Infinity);
      return state.sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    }
    const strA = String(aValue || '').toLowerCase(); const strB = String(bValue || '').toLowerCase();
    if (strA < strB) return state.sortDirection === 'asc' ? -1 : 1;
    if (strA > strB) return state.sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const html = sortedReleases.map(item => `
    <tr>
      <td>${escapeHtml(item.artist)}</td>
      <td>
        <a href="${escapeHtml(item.discogsUrl)}" target="_blank" rel="noopener noreferrer" title="View on Discogs: ${escapeHtml(item.title)}">
          ${escapeHtml(item.title)}
        </a>
        </td>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(item.year)}</td>
      <td>${escapeHtml(item.credits)}</td>
      <td>
        ${item.artwork ? `
          <img src="${escapeHtml(item.artwork)}" alt="Artwork for ${escapeHtml(item.title)}"
               class="artwork-thumb" data-full-url="${escapeHtml(item.artwork)}"
               data-title="${escapeHtml(item.title)}" title="Click to view artwork for: ${escapeHtml(item.title)}">
        ` : 'No artwork'}
      </td>
    </tr>
  `).join('');
  elements.gridBody.innerHTML = html;

  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-sort') === state.sortColumn) {
      th.classList.add(state.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
  document.querySelectorAll('.artwork-thumb').forEach(img => {
    img.removeEventListener('click', handleArtworkThumbClick);
    img.addEventListener('click', handleArtworkThumbClick);
  });
}

function handleArtworkThumbClick(event) {
    const fullUrl = event.target.getAttribute('data-full-url');
    const title = event.target.getAttribute('data-title');
    if (fullUrl && elements.artworkModal && elements.modalImage && elements.modalCaption) {
        openArtworkModal(fullUrl, title);
    } else if (!fullUrl) {
        log('No full URL found for artwork.', 'warning');
    } else {
        log('Artwork modal elements not found, cannot open modal.', 'error');
    }
}

export function updateErrorPanel() {
  if (!elements.errorCount || !elements.errorPanel || !elements.errorBody) return;
  const count = state.failedQueue.length;
  elements.errorCount.textContent = count;
  if (count === 0) {
    elements.errorPanel.classList.add('d-none');
    if (elements.throttleWarning) elements.throttleWarning.classList.add('d-none');
    return;
  }
  elements.errorPanel.classList.remove('d-none');
  const html = state.failedQueue.map(item => `
    <tr>
      <td>${item.id} (${item.type || 'release'})</td>
      <td>${escapeHtml(item.title || `Item ${item.id}`)}</td>
      <td>${escapeHtml(item.error)}</td>
      <td>
        <button class="btn btn--sm btn--primary retry-single-btn"
                data-retry-id="${item.id}" data-retry-type="${item.type || 'release'}"
                aria-label="Retry ${item.type || 'release'} ${item.id}">Retry now</button>
      </td>
    </tr>
  `).join('');
  elements.errorBody.innerHTML = html;
  document.querySelectorAll('.retry-single-btn').forEach(btn => {
    btn.removeEventListener('click', handleRetrySingleClick);
    btn.addEventListener('click', handleRetrySingleClick);
  });
}

function handleRetrySingleClick(event) {
    const btn = event.currentTarget;
    const idToRetry = parseInt(btn.getAttribute('data-retry-id'));
    const typeToRetry = btn.getAttribute('data-retry-type');
    scanServiceRetrySingleItem(idToRetry, typeToRetry);
}

export function updateLastUpdatedText() {
  if (!elements.lastUpdatedText) return;
  if (!state.lastUpdated) {
    elements.lastUpdatedText.textContent = 'Last updated: Never'; return;
  }
  try {
    elements.lastUpdatedText.textContent = `Last updated: ${new Date(state.lastUpdated).toLocaleString()}`;
  } catch (e) {
    elements.lastUpdatedText.textContent = 'Last updated: Invalid date';
    log(`Error formatting lastUpdated date: ${state.lastUpdated}`, 'error');
  }
}

export function updateLoadingState(isLoading, statusText = 'Scanning...') {
  if (elements.scanBtn) elements.scanBtn.disabled = isLoading;
  if (elements.exportBtn) elements.exportBtn.disabled = isLoading;
  if (elements.clearBtn) elements.clearBtn.disabled = isLoading;
  if (elements.artistIdInput) elements.artistIdInput.disabled = isLoading;
  if (elements.discogsTokenInput) elements.discogsTokenInput.disabled = isLoading;
  if (elements.saveSettingsBtn) elements.saveSettingsBtn.disabled = isLoading;

  if (elements.scanSpinner) elements.scanSpinner.classList.toggle('d-none', !isLoading);
  if (elements.scanBtnText && elements.scanBtn) {
    elements.scanBtnText.textContent = isLoading ? (statusText.includes('...') ? statusText : `${statusText}...`) : 'Start Scan';
  }
  if (elements.progressContainer) elements.progressContainer.classList.toggle('d-none', !isLoading);
  if (!isLoading) {
    if (elements.progressBar) elements.progressBar.style.width = '0%';
    if (elements.progressCount) elements.progressCount.textContent = '0/0';
    if (elements.progressStatus) elements.progressStatus.textContent = 'Idle';
  }
}

export function updateProgress(current, total, statusMessage = "Loading items...") {
  if (!elements.progressBar || !elements.progressCount || !elements.progressStatus) return;
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressBar.setAttribute('aria-valuenow', percentage);
  elements.progressCount.textContent = `${current}/${total}`;
  elements.progressStatus.textContent = statusMessage;
}

function checkOfflineStatus() {
  if (!elements.offlineBanner) return;
  const updateOnlineStatus = () => {
    elements.offlineBanner.classList.toggle('d-none', navigator.onLine);
    if (!navigator.onLine) log('Device is offline - using cached data only. Some operations may fail.', 'warning');
    else log('Device is online.', 'info');
  };
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function addEventListeners() {
  if (elements.saveSettingsBtn) elements.saveSettingsBtn.addEventListener('click', saveUserSettings);
  if (elements.scanBtn) elements.scanBtn.addEventListener('click', startFullScan);
  if (elements.stopScanBtn) {
    elements.stopScanBtn.addEventListener('click', () => {
      log('Stop scan button clicked by user. Halting operations at the next available check...', 'warning');
      state.isScanManuallyStopped = true;
      elements.stopScanBtn.disabled = true;
      elements.stopScanBtn.textContent = 'Stopping...';
    });
  }
  if (elements.exportBtn) elements.exportBtn.addEventListener('click', exportCSV);
  if (elements.importBtn) elements.importBtn.addEventListener('click', () => elements.csvImportInput.click());
  if (elements.clearBtn) elements.clearBtn.addEventListener('click', clearCurrentArtistCache);

  // Modal close button listener
  if (elements.modalCloseBtn) {
    elements.modalCloseBtn.addEventListener('click', closeArtworkModal);
  } else {
    log('Modal close button (.modal-close-btn) not found.', 'warning');
  }
  // Close modal if backdrop is clicked
  if (elements.artworkModal) {
    elements.artworkModal.addEventListener('click', (event) => {
        if (event.target === elements.artworkModal) {
            closeArtworkModal();
        }
    });
  } else {
    log('Artwork modal (artworkModal) not found.', 'warning');
  }

  // Bootstrap collapse listeners for log and error panels
  if (elements.errorContent) {
    elements.errorContent.addEventListener('shown.bs.collapse', () => {
      state.errorsVisible = true; if (elements.toggleErrorsText) elements.toggleErrorsText.textContent = 'Hide';
    });
    elements.errorContent.addEventListener('hidden.bs.collapse', () => {
      state.errorsVisible = false; if (elements.toggleErrorsText) elements.toggleErrorsText.textContent = 'Show';
    });
  }
  if (elements.logContentCollapse) {
    elements.logContentCollapse.addEventListener('shown.bs.collapse', () => {
      state.logVisible = true; if (elements.toggleLogText) elements.toggleLogText.textContent = 'Hide';
    });
    elements.logContentCollapse.addEventListener('hidden.bs.collapse', () => {
      state.logVisible = false; if (elements.toggleLogText) elements.toggleLogText.textContent = 'Show';
    });
  }
  // Bootstrap collapse listeners for settings panel
  if (elements.settingsContentCollapse) {
    elements.settingsContentCollapse.addEventListener('shown.bs.collapse', () => {
      // state.settingsVisible = true; // Optional
      if (elements.toggleSettingsText) elements.toggleSettingsText.textContent = 'Hide';
    });
    elements.settingsContentCollapse.addEventListener('hidden.bs.collapse', () => {
      // state.settingsVisible = false; // Optional
      if (elements.toggleSettingsText) elements.toggleSettingsText.textContent = 'Show';
    });
  }
  // Table header sorting listeners
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      if (state.isLoading) return;
      const column = th.getAttribute('data-sort');
      if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = column; state.sortDirection = 'asc';
      }
      renderReleases();
    });
  });

  // CSV Import file input listener
  if (elements.csvImportInput) elements.csvImportInput.addEventListener('change', handleFileSelectForImport);

}

document.addEventListener('DOMContentLoaded', () => { init(); });
