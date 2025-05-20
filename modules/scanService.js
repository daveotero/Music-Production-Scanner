// modules/scanService.js
import { state } from './state.js';
import { elements } from './domElements.js';
import { CACHE_KEYS, DISCOGS_BASE_URL, MAX_ADDITIONAL_VERSIONS_FOR_CREDITS } from './constants.js';
import { log, delay, getArtistCacheKey } from './utils.js';
import { fetchWithRetry } from './apiService.js';
import {
    renderReleases,
    updateErrorPanel,
    updateLastUpdatedText,
    updateLoadingState,
    updateProgress
} from '../app.js'; // Importing UI functions from app.js

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
            else await delay(100); // Shorter delay for the very first page
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
            for (let j = i; j < total; j++) { // Mark remaining items as failed due to stop
                failedFetches.push({ ...itemsToFetch[j], error: 'Scan stopped before processing item', timestamp: Date.now() });
            }
            break;
        }
        const itemInitialData = itemsToFetch[i];
        let isMasterFetch = itemInitialData.type === 'master';
        let masterApiData = null; let keyReleaseApiData = null; let additionalVersionApiDataArray = [];
        try {
            if (i > 0 || total === 1) await delay(state.requestDelayMs); // Full delay for subsequent items or single item
            else if (total > 1 && i === 0) await delay(100); // Shorter delay for the very first item in a batch
            if (state.isScanManuallyStopped) throw new Error("Scan manually stopped before API call for item " + itemInitialData.id);

            if (isMasterFetch) {
                const masterUrl = `${DISCOGS_BASE_URL}/masters/${itemInitialData.id}`;
                log(`Fetching MASTER ID: ${itemInitialData.id} ("${itemInitialData.title}") from ${masterUrl}`);
                masterApiData = await fetchWithRetry(masterUrl);
                if (state.isScanManuallyStopped) throw new Error("Scan manually stopped after master fetch for " + itemInitialData.id);
                const keyReleaseId = masterApiData.main_release;
                if (keyReleaseId) {
                    log(`Master ${masterApiData.id} has Key Release ID: ${keyReleaseId}. Fetching its details.`);
                    await delay(state.requestDelayMs / 2 < 500 ? 500 : state.requestDelayMs / 2); // Half delay
                    if (state.isScanManuallyStopped) throw new Error("Scan manually stopped before key release fetch for " + itemInitialData.id);
                    try { keyReleaseApiData = await fetchWithRetry(`${DISCOGS_BASE_URL}/releases/${keyReleaseId}`); }
                    catch (keyReleaseError) { log(`Failed to fetch Key Release ${keyReleaseId} for master ${masterApiData.id}: ${keyReleaseError.message}`, 'warning'); }
                } else { log(`Master ${masterApiData.id} does not have a main_release_id.`, 'info'); }

                let keyReleaseHasCredits = keyReleaseApiData ? hasTargetArtistCredits(keyReleaseApiData, state.TARGET_ARTIST_NAME_VARIANTS) : false;
                if (!keyReleaseHasCredits) {
                    log(`Key Release (ID: ${keyReleaseId || 'N/A'}) for master ${masterApiData.id} lacks target artist credits or was not fetched. Attempting to find credits in other versions.`, 'info');
                    if (masterApiData.versions_url) {
                        const versionIdsToFetch = new Set();
                        try {
                            const versionsListResponse = await fetchWithRetry(masterApiData.versions_url + `?per_page=${MAX_ADDITIONAL_VERSIONS_FOR_CREDITS * 2 + 5}&sort=released&sort_order=desc`);
                            if (versionsListResponse && versionsListResponse.versions) {
                                for (const version of versionsListResponse.versions) {
                                    if (version.id === keyReleaseId) continue; // Skip the key release itself
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
                                await delay(state.requestDelayMs / 2 < 500 ? 500 : state.requestDelayMs / 2); // Half delay
                                const versionData = await fetchWithRetry(`${DISCOGS_BASE_URL}/releases/${versionId}`);
                                additionalVersionApiDataArray.push(versionData);
                            } catch (versionFetchError) { log(`Failed to fetch additional version ${versionId} for master ${masterApiData.id}: ${versionFetchError.message}`, 'warning'); }
                        }
                    }
                } else { log(`Key Release (ID: ${keyReleaseId}) for master ${masterApiData.id} provided target artist credits. Not fetching additional versions for credits.`, 'info'); }
            } else { // It's a release, not a master
                const releaseUrl = `${DISCOGS_BASE_URL}/releases/${itemInitialData.id}`;
                log(`Fetching RELEASE ID: ${itemInitialData.id} ("${itemInitialData.title}") from ${releaseUrl}`);
                keyReleaseApiData = await fetchWithRetry(releaseUrl); // This will be the main data source
            }

            if (state.isScanManuallyStopped) throw new Error("Scan manually stopped after all API fetches for item " + itemInitialData.id);
            const processedItem = processApiData(masterApiData, keyReleaseApiData, additionalVersionApiDataArray, itemInitialData, isMasterFetch);
            successfulFetches.push(processedItem);
            log(`Successfully processed: ${processedItem.title} (ID: ${processedItem.id}, Type: ${isMasterFetch ? 'Master' : 'Release'})`);
        } catch (error) {
            const message = error.message || "Unknown error during item processing";
            if (message.startsWith("Scan manually stopped")) {
                log(message, 'warning'); // Log specific stop message
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
        return initialItemData.artist_from_list; // Fallback
    };

    if (isMaster) {
        processed.discogsUrl = `https://www.discogs.com/master/${initialItemData.id}`;
        if (masterApiData && masterApiData.title) processed.title = masterApiData.title;
        // Artist and year can come from master, or fallback to key release or initial data
        processed.artist = getArtistString(masterApiData ? masterApiData.artists : (keyReleaseData ? keyReleaseData.artists : null));
        processed.year = String((masterApiData ? masterApiData.year : null) || (keyReleaseData ? keyReleaseData.year : null) || initialItemData.year_from_list || 'Unknown');

        if (masterApiData && masterApiData.images && masterApiData.images.length > 0) {
            processed.artwork = masterApiData.images[0].uri;
        }

        let primaryDataSourceForDetails = keyReleaseData; // Key release is primary for details if available
        if (primaryDataSourceForDetails) {
            processed.representativeVersionId = primaryDataSourceForDetails.id;
            if (primaryDataSourceForDetails.labels && primaryDataSourceForDetails.labels.length > 0) {
                processed.label = primaryDataSourceForDetails.labels.map(l => l.name).join(' / ');
            }
            if (primaryDataSourceForDetails.year) { processed.year = String(primaryDataSourceForDetails.year); } // Prefer key release year if available
            // Prefer key release image if master image wasn't good or available
            if ((!processed.artwork || processed.artwork === initialItemData.thumb_from_list) && primaryDataSourceForDetails.images && primaryDataSourceForDetails.images.length > 0) {
                processed.artwork = primaryDataSourceForDetails.images[0].uri;
            } else if (!processed.artwork && primaryDataSourceForDetails.thumb) { // Fallback to thumb from key release
                processed.artwork = primaryDataSourceForDetails.thumb;
            }
        }

        // Aggregate credits from key release and any additional fetched versions
        const allVersionsForCredits = [];
        if (keyReleaseData) allVersionsForCredits.push(keyReleaseData);
        if (additionalVersionDataArray && additionalVersionDataArray.length > 0) {
            allVersionsForCredits.push(...additionalVersionDataArray);
        }

        if (allVersionsForCredits.length > 0) {
            const aggregatedRolesContainer = { produced: new Set(), engineered: new Set(), mixed: new Set(), mastered: new Set() };
            allVersionsForCredits.forEach(versionData => {
                if (versionData) { // Ensure versionData is not null/undefined
                    const versionArtistRoles = extractArtistRoles(versionData, state.TARGET_ARTIST_NAME_VARIANTS);
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

    } else { // It's a Release
        const releaseData = keyReleaseData; // For non-masters, keyReleaseData is the releaseData itself
        if (!releaseData) {
            log(`Error: Release data is missing for non-master item ID ${initialItemData.id}. Using initial data.`, 'error');
            processed.discogsUrl = `https://www.discogs.com/release/${initialItemData.id}`;
            processed.credits = 'N/A (Failed to fetch release details)'; return processed;
        }
        processed.discogsUrl = releaseData.uri || `https://www.discogs.com/release/${initialItemData.id}`;
        processed.title = releaseData.title || initialItemData.title;
        processed.artist = getArtistString(releaseData.artists);
        processed.year = String(releaseData.year || initialItemData.year_from_list || 'Unknown');
        if (releaseData.labels && releaseData.labels.length > 0) {
            processed.label = releaseData.labels.map(l => l.name).join(' / ');
        }
        if (releaseData.images && releaseData.images.length > 0) {
            processed.artwork = releaseData.images[0].uri;
        } else if (releaseData.thumb && !processed.artwork) { // Use thumb only if no primary image and artwork not already set
            processed.artwork = releaseData.thumb;
        }
        processed.credits = formatArtistRoles(extractArtistRoles(releaseData, state.TARGET_ARTIST_NAME_VARIANTS));
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
        if (lowerRole.includes('produc')) return 'produced'; // Catches "producer", "produced by", etc.
        if (lowerRole.includes('mix') || lowerRole.includes('mixer')) return 'mixed';
        if (lowerRole.includes('master')) return 'mastered';
        return null;
    }

    allCreditsData.forEach(credit => {
        const creditNameLower = credit.name ? credit.name.toLowerCase().trim() : '';
        let isTargetArtist = false;
        if (artistNameVariants.length > 0) {
            isTargetArtist = artistNameVariants.some(variant => creditNameLower.includes(variant));
        } else if (state.currentArtistName) { // Fallback if variants somehow empty but name exists
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

    const itemsToRetry = [...state.failedQueue]; // Clone for iteration
    state.failedQueue = []; // Clear original queue, will repopulate with any still-failed items

    updateProgress(0, itemsToRetry.length, 'Retrying failed...');
    const { successful, failed: stillFailedAfterRetry } = await fetchAndProcessItemDetails(itemsToRetry);

    if (successful.length > 0) {
        successful.forEach(s => {
            const existingIndex = state.releases.findIndex(r => r.id === s.id && r.isMaster === s.isMaster);
            if (existingIndex === -1) state.releases.push(s);
            else state.releases[existingIndex] = s; // Update existing
        });
    }
    if (stillFailedAfterRetry.length > 0) {
        // Add back items that still failed, ensuring no duplicates in the failedQueue
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

export async function retrySingleItem(id, type) {
    if (state.isLoading && elements.stopScanBtn && !elements.stopScanBtn.classList.contains('d-none')) {
        log('Full scan in progress. Please wait or stop the current scan to retry single items.', 'warning');
        return;
    }
    const wasAlreadyLoading = state.isLoading; // To restore state if this is a one-off retry during a non-scan period
    state.isLoading = true;
    updateLoadingState(true, `Retrying ${type} ${id}...`);

    try {
        const failedItemIndex = state.failedQueue.findIndex(item => item.id === id && item.type === type);
        if (failedItemIndex === -1) {
            log(`Item ${type} ${id} not found in failed queue.`, 'info');
            if (!wasAlreadyLoading) state.isLoading = false; // Only reset if it wasn't already loading
            updateLoadingState(state.isLoading, state.isLoading ? 'Scan in progress...' : '');
            return;
        }
        const failedItemInitialData = state.failedQueue[failedItemIndex];
        log(`Retrying single ${failedItemInitialData.type} ${id}: ${failedItemInitialData.title}`);

        // Visually update the specific retry button
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
            state.failedQueue.splice(failedItemIndex, 1); // Remove from failed queue
            log(`Successfully retried ${type} ${id} (${processedItem.title}). Removed from failed queue.`);
        } else if (failed.length > 0) {
            // Update the item in the failed queue with the new error/timestamp
            state.failedQueue[failedItemIndex] = { ...failed[0], timestamp: Date.now() };
            log(`Failed to retry ${type} ${id} (${failedItemInitialData.title}): ${failed[0].error}`, 'error');
        }

        deduplicateReleases();
        await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);

    } catch (error) {
        log(`Error in retrySingleItem wrapper for ${type} ${id}: ${error.message}`, 'error');
        // Ensure the item is updated in the failed queue if an unexpected error occurs
        const failedItemIndexCheck = state.failedQueue.findIndex(item => item.id === id && item.type === type);
        if (failedItemIndexCheck !== -1) {
            state.failedQueue[failedItemIndexCheck].error = error.message; // Update error message
            state.failedQueue[failedItemIndexCheck].timestamp = Date.now(); // Update timestamp
        }
    } finally {
        await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);
        renderReleases(); // Render releases to reflect any successful retries
        updateErrorPanel(); // Update error panel to reflect changes
        if (!wasAlreadyLoading || state.isScanManuallyStopped) { // If it wasn't loading before, or if scan was stopped
            state.isLoading = false; updateLoadingState(false);
        } else { updateLoadingState(true, 'Scan in progress...'); } // Otherwise, assume scan continues
    }
}

export async function runScanCycle() {
    if (state.failedQueue.length > 0 && !state.isScanManuallyStopped) {
        log('Scan Cycle Phase 1: Retrying failed items...');
        await retryFailedItems();
    }
    if (!state.isScanManuallyStopped) {
        log('Scan Cycle Phase 2: Fetching all/new items...');
        await fetchAllItems();
    }
}