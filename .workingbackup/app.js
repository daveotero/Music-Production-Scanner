// app.js - Music Production Scanner v8
// - Parses Artist ID input like [a12345]
// - Fetches Key Release for masters.
// - Conditionally fetches additional versions ONLY if Key Release lacks target artist credits.
// - Aims for a deduplicated list for the user.
// - Dynamic rate limiting based on token presence.
// - In-page modal for artwork.

// Constants
const CACHE_KEYS = {
  RELEASES_PREFIX: 'releases_',
  LAST_UPDATED_PREFIX: 'lastUpdated_',
  FAILED_QUEUE_PREFIX: 'failedQueue_',
  USER_SETTINGS: 'userSettings'
};
const DISCOGS_BASE_URL = 'https://api.discogs.com';
const TOKEN_PRESENT_DELAY_MS = 1100; // Delay if Discogs token is present
const NO_TOKEN_DELAY_MS = 3000;    // Delay if no Discogs token
// Fetch up to this many *additional* versions if key release lacks credits for the target artist.
const MAX_ADDITIONAL_VERSIONS_FOR_CREDITS = 2;
let TARGET_ARTIST_NAME_VARIANTS = [];

// DOM elements
const elements = {
  mainHeading: document.getElementById('mainHeading'),
  lastUpdatedText: document.getElementById('lastUpdatedText'),
  artistIdInput: document.getElementById('artistIdInput'),
  discogsTokenInput: document.getElementById('discogsTokenInput'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  scanBtn: document.getElementById('scanBtn'),
  scanBtnText: document.getElementById('scanBtnText'),
  scanSpinner: document.getElementById('scanSpinner'),
  stopScanBtn: document.getElementById('stopScanBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearBtn: document.getElementById('clearBtn'),
  progressContainer: document.getElementById('progressContainer'),
  progressBar: document.getElementById('progressBar'),
  progressStatus: document.getElementById('progressStatus'),
  progressCount: document.getElementById('progressCount'),
  gridBody: document.getElementById('gridBody'),
  noDataRow: document.getElementById('noDataRow'),
  errorPanel: document.getElementById('errorPanel'),
  errorContent: document.getElementById('errorContent'),
  errorCount: document.getElementById('errorCount'),
  errorBody: document.getElementById('errorBody'),
  toggleErrorsBtn: document.getElementById('toggleErrorsBtn'),
  toggleErrorsText: document.getElementById('toggleErrorsText'),
  throttleWarning: document.getElementById('throttleWarning'),
  logPanel: document.getElementById('logPanel'),
  log: document.getElementById('log'),
  logContentCollapse: document.getElementById('logContentCollapse'),
  toggleLogBtn: document.getElementById('toggleLogBtn'),
  toggleLogText: document.getElementById('toggleLogText'),
  offlineBanner: document.getElementById('offlineBanner'),
  // Modal elements
  artworkModal: document.getElementById('artworkModal'),
  modalImage: document.getElementById('modalImage'),
  modalCaption: document.getElementById('modalCaption'),
  modalCloseBtn: document.querySelector('.modal-close-btn')
};


// State management
let state = {
  currentArtistId: null,
  currentArtistName: null,
  discogsToken: null,
  releases: [],
  failedQueue: [],
  lastUpdated: null,
  isLoading: false,
  isScanManuallyStopped: false,
  sortColumn: 'artist',
  sortDirection: 'asc',
  errorsVisible: true,
  logVisible: true,
  requestDelayMs: NO_TOKEN_DELAY_MS,
  isModalOpen: false // Track modal state
};

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
        TARGET_ARTIST_NAME_VARIANTS = generateNameVariants(settings.artistName);
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
              TARGET_ARTIST_NAME_VARIANTS = generateNameVariants(artistData.name);
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
              TARGET_ARTIST_NAME_VARIANTS = [];
              await localforage.setItem(CACHE_KEYS.USER_SETTINGS, { artistId: state.currentArtistId, token: state.discogsToken, artistName: null });
          }
      } catch (error) {
          log(`Error fetching artist details for settings: ${error.message}`, 'error');
          state.currentArtistName = null;
          updateMainHeading();
          TARGET_ARTIST_NAME_VARIANTS = [];
          await localforage.setItem(CACHE_KEYS.USER_SETTINGS, { artistId: state.currentArtistId, token: state.discogsToken, artistName: null });
      }
  }
}

function updateMainHeading(artistName = null) {
    if (elements.mainHeading) {
        if (artistName && state.currentArtistId) {
            elements.mainHeading.innerHTML =
                `<a href="https://www.discogs.com/artist/${state.currentArtistId}" target="_blank" rel="noopener noreferrer" title="View ${escapeHtml(artistName)} on Discogs">${escapeHtml(artistName)}</a>'s Production Scanner`;
        } else if (artistName) {
            elements.mainHeading.textContent = `${artistName}'s Production Scanner`;
        } else {
            elements.mainHeading.textContent = 'Music Production Scanner';
        }
    }
}

function generateNameVariants(artistName) {
    if (!artistName) return [];
    const nameLower = artistName.toLowerCase();
    const variants = new Set([nameLower, artistName]);
    if (nameLower.startsWith("the ")) {
        variants.add(nameLower.substring(4));
    }
    return Array.from(variants);
}

async function fetchArtistDetails(artistId) {
    if (!artistId) return null;
    if (!state.discogsToken) {
        log('Discogs token not set. Fetching artist details unauthenticated.', 'info');
    }
    const url = `${DISCOGS_BASE_URL}/artists/${artistId}`;
    try {
        const data = await fetchWithRetry(url, {}, 2);
        return data;
    } catch (error) {
        log(`Failed to fetch artist details for ID ${artistId}: ${error.message}`, 'error');
        return null;
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

  if (state.currentArtistId) {
    await loadCachedDataForCurrentArtist();
  } else {
    log('Please enter a Discogs Artist ID and your Discogs Token, then click "Save Settings".');
    if(elements.noDataRow) elements.noDataRow.classList.remove('d-none');
  }
}
function getArtistCacheKey(prefix) {
    if (!state.currentArtistId) throw new Error("Artist ID not set for cache key generation.");
    return `${prefix}${state.currentArtistId}`;
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
    if (state.failedQueue.length > 0 && !state.isScanManuallyStopped) {
      log('Phase 1: Retrying failed items...');
      await retryFailedItems();
    }
    if (!state.isScanManuallyStopped) {
      log('Phase 2: Fetching all/new items...');
      await fetchAllItems();
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

async function fetchAllItems() {
  if (state.isScanManuallyStopped || !state.currentArtistId) return;
  updateLoadingState(true, `Fetching all items for ${state.currentArtistName || state.currentArtistId}...`);
  log(`Starting incremental update for Artist ID: ${state.currentArtistId} (fetchAllItems). Current delay: ${state.requestDelayMs}ms.`);

  let newItemsToFetch = [];
  try {
    const maxCachedId = state.releases.length > 0 ? Math.max(...state.releases.map(r => r.id)) : 0;
    log(`Highest cached item ID for this artist: ${maxCachedId}`);
    newItemsToFetch = await getNewArtistItems(maxCachedId);

    if (state.isScanManuallyStopped) { log('Scan stopped during getNewArtistItems.', 'warning'); return; }
    if (newItemsToFetch.length === 0) {
      log('No new items to fetch for this artist.');
      state.lastUpdated = Date.now();
      await localforage.setItem(getArtistCacheKey(CACHE_KEYS.LAST_UPDATED_PREFIX), state.lastUpdated);
      updateLastUpdatedText(); return;
    }

    log(`Found ${newItemsToFetch.length} new items to fetch for this artist.`);
    updateProgress(0, newItemsToFetch.length, 'Fetching new items...');
    const { successful, failed } = await fetchAndProcessItemDetails(newItemsToFetch);

    successful.forEach(s => {
      const existingIndex = state.releases.findIndex(r => r.id === s.id && r.isMaster === s.isMaster);
      if (existingIndex !== -1) state.releases[existingIndex] = s;
      else state.releases.push(s);
    });
    failed.forEach(failure => {
      if (!state.failedQueue.some(f => f.id === failure.id && f.type === failure.type)) {
        state.failedQueue.push(failure);
      }
    });
    deduplicateReleases();

    if (state.isScanManuallyStopped) { log('Scan stopped during fetchAllItems. Partially fetched data processed.', 'warning'); }
    await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);
    await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);
    renderReleases(); updateErrorPanel();
    if (!state.isScanManuallyStopped && (successful.length > 0 || newItemsToFetch.length === 0)) {
        state.lastUpdated = Date.now();
        await localforage.setItem(getArtistCacheKey(CACHE_KEYS.LAST_UPDATED_PREFIX), state.lastUpdated);
        updateLastUpdatedText();
    }
  } catch (error) {
    log(`Error during fetchAllItems for Artist ID ${state.currentArtistId}: ${error.message}`, 'error');
  }
}

function deduplicateReleases() {
    const finalReleases = [];
    const processedMasterRepVersionIds = new Set();
    const sortedForDeduplication = [...state.releases].sort((a, b) => {
        if (a.isMaster && !b.isMaster) return -1;
        if (!a.isMaster && b.isMaster) return 1;
        return 0;
    });
    for (const item of sortedForDeduplication) {
        if (item.isMaster) {
            finalReleases.push(item);
            if (item.representativeVersionId) {
                processedMasterRepVersionIds.add(item.representativeVersionId);
            }
        } else {
            if (!processedMasterRepVersionIds.has(item.id)) {
                finalReleases.push(item);
            } else {
                log(`Deduplicating: Specific release ${item.id} (${item.title}) is represented by a master.`, 'info');
            }
        }
    }
    state.releases = finalReleases;
    log(`Deduplication complete. Final item count: ${state.releases.length}`);
}

async function getNewArtistItems(maxCachedId) {
  if (!state.currentArtistId) return [];
  const newItems = []; let page = 1; let hasMore = true;
  while (hasMore && !state.isScanManuallyStopped) {
    try {
      log(`Fetching artist items page ${page} for Artist ID ${state.currentArtistId}`);
      if (page > 1) await delay(state.requestDelayMs / 2 < 500 ? 500 : state.requestDelayMs / 2);
      else await delay(100);
      if (state.isScanManuallyStopped) break;
      const url = `${DISCOGS_BASE_URL}/artists/${state.currentArtistId}/releases?per_page=100&page=${page}`;
      const data = await fetchWithRetry(url);
      if (state.isScanManuallyStopped) break;
      if (!data || !data.releases || !data.pagination) {
        log('Unexpected response structure from artist releases endpoint.', 'warning');
        hasMore = false; break;
      }
      hasMore = data.pagination.pages > 0 && data.pagination.page < data.pagination.pages;
      const pageItems = data.releases
        .filter(release => release.id > maxCachedId && (release.role === "Main" || release.type === "master" || !release.role))
        .map(release => ({
          id: release.id, title: release.title, type: release.type,
          artist_from_list: release.artist, year_from_list: release.year,
          thumb_from_list: release.thumb, role_from_list: release.role
        }));
      newItems.push(...pageItems);
      log(`Page ${page}: Found ${pageItems.length} potential new items. Total accumulated: ${newItems.length}`);
      page++;
    } catch (error) {
      log(`Error fetching artist items list (page ${page}): ${error.message}`, 'error');
      hasMore = false;
    }
  }
  log(`Finished scanning for new items for Artist ID ${state.currentArtistId}. Found ${newItems.length} total.`);
  return newItems;
}

async function fetchAndProcessItemDetails(itemsToFetch) {
  const total = itemsToFetch.length;
  const successfulFetches = []; const failedFetches = []; let completedCount = 0;
  log(`Starting to fetch details for ${total} items sequentially (fetchAndProcessItemDetails).`);
  updateProgress(completedCount, total, 'Preparing to fetch details...');

  for (let i = 0; i < total; i++) {
    if (state.isScanManuallyStopped) {
        log('Scan manually stopped during fetchAndProcessItemDetails item loop.', 'warning');
        for (let j = i; j < total; j++) {
            failedFetches.push({ ...itemsToFetch[j], error: 'Scan stopped before processing item', timestamp: Date.now() });
        }
        break;
    }
    const itemInitialData = itemsToFetch[i];
    let isMasterFetch = itemInitialData.type === 'master';
    let masterApiData = null; let keyReleaseApiData = null; let additionalVersionApiDataArray = [];
    try {
      if (i > 0 || total === 1) await delay(state.requestDelayMs);
      else if (total > 1 && i === 0) await delay(100);
      if (state.isScanManuallyStopped) throw new Error("Scan manually stopped before API call for item " + itemInitialData.id);

      if (isMasterFetch) {
        const masterUrl = `${DISCOGS_BASE_URL}/masters/${itemInitialData.id}`;
        log(`Fetching MASTER ID: ${itemInitialData.id} ("${itemInitialData.title}") from ${masterUrl}`);
        masterApiData = await fetchWithRetry(masterUrl);
        if (state.isScanManuallyStopped) throw new Error("Scan manually stopped after master fetch for " + itemInitialData.id);
        const keyReleaseId = masterApiData.main_release;
        if (keyReleaseId) {
          log(`Master ${masterApiData.id} has Key Release ID: ${keyReleaseId}. Fetching its details.`);
          await delay(state.requestDelayMs / 2 < 500 ? 500 : state.requestDelayMs / 2);
          if (state.isScanManuallyStopped) throw new Error("Scan manually stopped before key release fetch for " + itemInitialData.id);
          try { keyReleaseApiData = await fetchWithRetry(`${DISCOGS_BASE_URL}/releases/${keyReleaseId}`); }
          catch (keyReleaseError) { log(`Failed to fetch Key Release ${keyReleaseId} for master ${masterApiData.id}: ${keyReleaseError.message}`, 'warning');}
        } else { log(`Master ${masterApiData.id} does not have a main_release_id.`, 'info'); }
        let keyReleaseHasCredits = keyReleaseApiData ? hasTargetArtistCredits(keyReleaseApiData, TARGET_ARTIST_NAME_VARIANTS) : false;
        if (!keyReleaseHasCredits) {
          log(`Key Release (ID: ${keyReleaseId || 'N/A'}) for master ${masterApiData.id} lacks target artist credits or was not fetched. Attempting to find credits in other versions.`, 'info');
          if (masterApiData.versions_url) {
            const versionIdsToFetch = new Set();
            try {
              const versionsListResponse = await fetchWithRetry(masterApiData.versions_url + `?per_page=${MAX_ADDITIONAL_VERSIONS_FOR_CREDITS * 2 + 5}&sort=released&sort_order=desc`);
              if (versionsListResponse && versionsListResponse.versions) {
                for (const version of versionsListResponse.versions) {
                  if (version.id === keyReleaseId) continue;
                  if (versionIdsToFetch.size >= MAX_ADDITIONAL_VERSIONS_FOR_CREDITS) break;
                  versionIdsToFetch.add(version.id);
                }
              }
            } catch (versionsError) { log(`Error fetching versions list for master ${masterApiData.id}: ${versionsError.message}`, 'warning'); }
            log(`Identified ${versionIdsToFetch.size} additional unique version(s) to fetch for master ${masterApiData.id}.`);
            for (const versionId of Array.from(versionIdsToFetch)) {
              if (state.isScanManuallyStopped) throw new Error("Scan manually stopped before fetching additional version for " + itemInitialData.id);
              try {
                log(`Fetching additional version ID: ${versionId} for master ${masterApiData.id}`);
                await delay(state.requestDelayMs / 2 < 500 ? 500 : state.requestDelayMs / 2);
                const versionData = await fetchWithRetry(`${DISCOGS_BASE_URL}/releases/${versionId}`);
                additionalVersionApiDataArray.push(versionData);
              } catch (versionFetchError) { log(`Failed to fetch additional version ${versionId} for master ${masterApiData.id}: ${versionFetchError.message}`, 'warning');}
            }
          }
        } else { log(`Key Release (ID: ${keyReleaseId}) for master ${masterApiData.id} provided target artist credits. Not fetching additional versions for credits.`, 'info');}
      } else {
        const releaseUrl = `${DISCOGS_BASE_URL}/releases/${itemInitialData.id}`;
        log(`Fetching RELEASE ID: ${itemInitialData.id} ("${itemInitialData.title}") from ${releaseUrl}`);
        keyReleaseApiData = await fetchWithRetry(releaseUrl);
      }
      if (state.isScanManuallyStopped) throw new Error("Scan manually stopped after all API fetches for item " + itemInitialData.id);
      const processedItem = processApiData(masterApiData, keyReleaseApiData, additionalVersionApiDataArray, itemInitialData, isMasterFetch);
      successfulFetches.push(processedItem);
      log(`Successfully processed: ${processedItem.title} (ID: ${processedItem.id}, Type: ${isMasterFetch ? 'Master' : 'Release'})`);
    } catch (error) {
      const message = error.message || "Unknown error during item processing";
      if (message.startsWith("Scan manually stopped")) {
          log(message, 'warning');
          failedFetches.push({ ...itemInitialData, error: 'Scan stopped during processing', timestamp: Date.now() });
      } else {
          log(`Failed to fetch or process ${itemInitialData.type || 'release'} ${itemInitialData.id} ("${itemInitialData.title}"): ${message}`, 'error');
          failedFetches.push({ ...itemInitialData, error: message, timestamp: Date.now() });
      }
    } finally {
        completedCount++;
        updateProgress(completedCount, total, `Processed ${completedCount}/${total}...`);
    }
  }
  return { successful: successfulFetches, failed: failedFetches };
}

function hasTargetArtistCredits(releaseData, artistNameVariants) {
    if (!releaseData) return false;
    const roles = extractArtistRoles(releaseData, artistNameVariants);
    return Object.values(roles).some(roleSet => roleSet.size > 0);
}

function processApiData(masterApiData, keyReleaseData, additionalVersionDataArray, initialItemData, isMaster) {
  let processed = {
    id: initialItemData.id, title: initialItemData.title, artist: initialItemData.artist_from_list,
    year: initialItemData.year_from_list, label: 'Unknown Label', credits: 'N/A',
    artwork: initialItemData.thumb_from_list || '', discogsUrl: '',
    isMaster: isMaster, type: initialItemData.type, representativeVersionId: null
  };
  const getArtistString = (artistsArray) => {
    if (artistsArray && artistsArray.length > 0) {
      return artistsArray.map(a => a.name.replace(/\(\d+\)$/, '').trim()).join(', ');
    }
    return initialItemData.artist_from_list;
  };
  if (isMaster) {
    processed.discogsUrl = `https://www.discogs.com/master/${initialItemData.id}`;
    if (masterApiData && masterApiData.title) processed.title = masterApiData.title;
    processed.artist = getArtistString(masterApiData ? masterApiData.artists : (keyReleaseData ? keyReleaseData.artists : null));
    processed.year = String((masterApiData ? masterApiData.year : null) || (keyReleaseData ? keyReleaseData.year : null) || initialItemData.year_from_list || 'Unknown');
    if (masterApiData && masterApiData.images && masterApiData.images.length > 0) {
      processed.artwork = masterApiData.images[0].uri;
    }
    let primaryDataSourceForDetails = keyReleaseData;
    if (primaryDataSourceForDetails) {
        processed.representativeVersionId = primaryDataSourceForDetails.id;
        if (primaryDataSourceForDetails.labels && primaryDataSourceForDetails.labels.length > 0) {
            processed.label = primaryDataSourceForDetails.labels.map(l => l.name).join(' / ');
        }
        if (primaryDataSourceForDetails.year) { processed.year = String(primaryDataSourceForDetails.year); }
        if ((!processed.artwork || processed.artwork === initialItemData.thumb_from_list) && primaryDataSourceForDetails.images && primaryDataSourceForDetails.images.length > 0) {
            processed.artwork = primaryDataSourceForDetails.images[0].uri;
        } else if (!processed.artwork && primaryDataSourceForDetails.thumb) {
            processed.artwork = primaryDataSourceForDetails.thumb;
        }
    }
    const allVersionsForCredits = [];
    if (keyReleaseData) allVersionsForCredits.push(keyReleaseData);
    if (additionalVersionDataArray && additionalVersionDataArray.length > 0) {
        allVersionsForCredits.push(...additionalVersionDataArray);
    }
    if (allVersionsForCredits.length > 0) {
      const aggregatedRolesContainer = { produced: new Set(), engineered: new Set(), mixed: new Set(), mastered: new Set() };
      allVersionsForCredits.forEach(versionData => {
        if (versionData) {
            const versionArtistRoles = extractArtistRoles(versionData, TARGET_ARTIST_NAME_VARIANTS);
            Object.keys(aggregatedRolesContainer).forEach(category => {
                versionArtistRoles[category].forEach(role => aggregatedRolesContainer[category].add(role));
            });
        }
      });
      processed.credits = formatArtistRoles(aggregatedRolesContainer);
       if (processed.credits === 'N/A' && allVersionsForCredits.length > 0) {
           log(`Credits still N/A for master ${initialItemData.id} after checking ${allVersionsForCredits.length} version(s).`, 'info');
       }
    } else {
      processed.credits = 'N/A (No version data for detailed credits)';
      log(`Master ${initialItemData.id} processed without any version details. Credits/label will be minimal.`, 'info');
    }
  } else {
    const releaseData = keyReleaseData;
    if (!releaseData) {
        log(`Error: Release data is missing for non-master item ID ${initialItemData.id}. Using initial data.`, 'error');
        processed.discogsUrl = `https://www.discogs.com/release/${initialItemData.id}`;
        processed.credits = 'N/A (Failed to fetch release details)'; return processed;
    }
    processed.discogsUrl = releaseData.uri || `https://www.discogs.com/release/${initialItemData.id}`;
    processed.artist = getArtistString(releaseData.artists);
    processed.year = String(releaseData.year || initialItemData.year_from_list || 'Unknown');
    if (releaseData.labels && releaseData.labels.length > 0) {
      processed.label = releaseData.labels.map(l => l.name).join(' / ');
    }
    if (releaseData.images && releaseData.images.length > 0) {
      processed.artwork = releaseData.images[0].uri;
    } else if (releaseData.thumb && !processed.artwork) { processed.artwork = releaseData.thumb; }
    processed.credits = formatArtistRoles(extractArtistRoles(releaseData, TARGET_ARTIST_NAME_VARIANTS));
  }
  return processed;
}

function extractArtistRoles(releaseData, artistNameVariants) {
    const roles = { produced: new Set(), engineered: new Set(), mixed: new Set(), mastered: new Set() };
    if (!releaseData || (!releaseData.credits && !releaseData.extraartists)) return roles;
    const allCreditsData = [...(releaseData.credits || []), ...(releaseData.extraartists || [])];
    function categorizeRoleKey(roleText) {
        if (!roleText || typeof roleText !== 'string') return null;
        const lowerRole = roleText.toLowerCase();
        if (lowerRole.includes('engineer') || lowerRole.includes('recording')) return 'engineered';
        if (lowerRole.includes('produc')) return 'produced';
        if (lowerRole.includes('mix') || lowerRole.includes('mixer')) return 'mixed';
        if (lowerRole.includes('master')) return 'mastered';
        return null;
    }
    allCreditsData.forEach(credit => {
        const creditNameLower = credit.name ? credit.name.toLowerCase().trim() : '';
        let isTargetArtist = false;
        if (artistNameVariants.length > 0) {
            isTargetArtist = artistNameVariants.some(variant => creditNameLower.includes(variant));
        } else if (state.currentArtistName) {
            isTargetArtist = creditNameLower.includes(state.currentArtistName.toLowerCase());
        }
        if (isTargetArtist) {
            const creditRolesText = Array.isArray(credit.role) ? credit.role : (credit.role ? [credit.role] : []);
            creditRolesText.forEach(roleText => {
                const categoryKey = categorizeRoleKey(roleText);
                if (categoryKey) { roles[categoryKey].add(roleText.trim()); }
            });
        }
    });
    return roles;
}

function formatArtistRoles(rolesObject) {
    let creditsParts = [];
    const displayOrder = [
        { key: 'produced', display: 'Produced' }, { key: 'engineered', display: 'Engineered' },
        { key: 'mixed', display: 'Mixed' }, { key: 'mastered', display: 'Mastered' }
    ];
    displayOrder.forEach(catInfo => {
        if (rolesObject[catInfo.key] && rolesObject[catInfo.key].size > 0) {
            creditsParts.push(`${catInfo.display}: ${Array.from(rolesObject[catInfo.key]).join(', ')}`);
        }
    });
    return creditsParts.length > 0 ? creditsParts.join('; ') : 'N/A';
}

async function retryFailedItems() {
  if (state.failedQueue.length === 0 || state.isScanManuallyStopped || !state.currentArtistId) return;
  updateLoadingState(true, 'Retrying failed items...');
  log(`Starting to retry ${state.failedQueue.length} failed items for Artist ID ${state.currentArtistId}.`);
  const itemsToRetry = [...state.failedQueue];
  state.failedQueue = [];
  updateProgress(0, itemsToRetry.length, 'Retrying failed...');
  const { successful, failed: stillFailedAfterRetry } = await fetchAndProcessItemDetails(itemsToRetry);
  if (successful.length > 0) {
    successful.forEach(s => {
      const existingIndex = state.releases.findIndex(r => r.id === s.id && r.isMaster === s.isMaster);
      if (existingIndex === -1) state.releases.push(s);
      else state.releases[existingIndex] = s;
    });
  }
  if (stillFailedAfterRetry.length > 0) {
    stillFailedAfterRetry.forEach(failedItem => {
        if (!state.failedQueue.some(f => f.id === failedItem.id && f.type === failedItem.type)) {
            state.failedQueue.push(failedItem);
        }
    });
  }
  deduplicateReleases();
  if (state.isScanManuallyStopped) { log('Retry process stopped by user. Partially processed data handled.', 'warning'); }
  else { log(`Successfully retried ${successful.length} items, ${stillFailedAfterRetry.length} still failed.`); }
  await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);
  await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);
  renderReleases(); updateErrorPanel();
}

async function retrySingleItem(id, type) {
  if (state.isLoading && elements.stopScanBtn && !elements.stopScanBtn.classList.contains('d-none')) {
    log('Full scan in progress. Please wait or stop the current scan to retry single items.', 'warning');
    return;
  }
  const wasAlreadyLoading = state.isLoading;
  state.isLoading = true;
  updateLoadingState(true, `Retrying ${type} ${id}...`);
  try {
    const failedItemIndex = state.failedQueue.findIndex(item => item.id === id && item.type === type);
    if (failedItemIndex === -1) {
      log(`Item ${type} ${id} not found in failed queue.`, 'info');
      if (!wasAlreadyLoading) state.isLoading = false;
      updateLoadingState(state.isLoading, state.isLoading ? 'Scan in progress...' : '');
      return;
    }
    const failedItemInitialData = state.failedQueue[failedItemIndex];
    log(`Retrying single ${failedItemInitialData.type} ${id}: ${failedItemInitialData.title}`);
    const retryBtn = document.querySelector(`[data-retry-id="${id}"][data-retry-type="${type}"]`);
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Retrying...';
    }
    const { successful, failed } = await fetchAndProcessItemDetails([failedItemInitialData]);
    if (successful.length > 0) {
        const processedItem = successful[0];
        const existingIndex = state.releases.findIndex(r => r.id === processedItem.id && r.isMaster === processedItem.isMaster);
        if (existingIndex === -1) state.releases.push(processedItem);
        else state.releases[existingIndex] = processedItem;
        state.failedQueue.splice(failedItemIndex, 1);
        log(`Successfully retried ${type} ${id} (${processedItem.title}). Removed from failed queue.`);
    } else if (failed.length > 0) {
        state.failedQueue[failedItemIndex] = { ...failed[0], timestamp: Date.now() };
        log(`Failed to retry ${type} ${id} (${failedItemInitialData.title}): ${failed[0].error}`, 'error');
    }
    deduplicateReleases();
    await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);
  } catch (error) {
    log(`Error in retrySingleItem wrapper for ${type} ${id}: ${error.message}`, 'error');
     const failedItemIndexCheck = state.failedQueue.findIndex(item => item.id === id && item.type === type);
     if (failedItemIndexCheck !== -1) {
         state.failedQueue[failedItemIndexCheck].error = error.message;
         state.failedQueue[failedItemIndexCheck].timestamp = Date.now();
     }
  } finally {
    await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);
    updateErrorPanel();
    if (!wasAlreadyLoading || state.isScanManuallyStopped) {
        state.isLoading = false; updateLoadingState(false);
    } else { updateLoadingState(true, 'Scan in progress...'); }
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
      if(elements.noDataRow) elements.noDataRow.textContent = `Cache cleared for ${state.currentArtistName || `Artist ID ${state.currentArtistId}`}. Click "Start Scan".`;
    } catch (error) {
      log(`Error clearing cache for current artist: ${error.message}`, 'error');
    }
  }
}

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  if (state.isScanManuallyStopped) throw new Error('Scan manually stopped during fetchWithRetry');
  const headers = {
    'User-Agent': 'MusicProductionScanner/1.4 (+YOUR_CONTACT_INFO_OR_PROJECT_URL)',
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
        waitTimeSeconds = Math.min(waitTimeSeconds, 60);
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
      if (error.message.startsWith('Scan manually stopped')) throw error;

      if (error.message.includes('HTTP error 401') || error.message.includes('HTTP error 403') || error.message.includes('HTTP error 404')) {
        log(`Unrecoverable client error for ${url.substring(0,80)}: ${error.message}. Not retrying this attempt.`, 'error');
        throw error;
      }

      const backoffSeconds = Math.min((2 ** attempt) * 2, 30);
      const jitter = Math.random() * 1000;
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

function delay(ms) {
  return new Promise(resolve => {
    if (state.isScanManuallyStopped) {
        log('Delay cancelled due to manual stop.', 'info');
        resolve(); return;
    }
    setTimeout(resolve, ms);
  });
}

// --- UI Rendering and Updates ---
function renderReleases() {
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

function updateErrorPanel() {
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
    retrySingleItem(idToRetry, typeToRetry);
}

function updateLastUpdatedText() {
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

function updateLoadingState(isLoading, statusText = 'Scanning...') {
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

function updateProgress(current, total, statusMessage = "Loading items...") {
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

function log(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  console[level === 'error' ? 'error' : (level === 'warning' ? 'warn' : 'info')](logEntry);

  if (elements.log) {
    const currentLogContent = elements.log.textContent;
    elements.log.textContent = `${logEntry}\n${currentLogContent}`;
    const maxLogLines = 200;
    const lines = elements.log.textContent.split('\n');
    if (lines.length > maxLogLines) {
        elements.log.textContent = lines.slice(0, maxLogLines).join('\n');
    }
  }
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
}

document.addEventListener('DOMContentLoaded', () => { init(); });
