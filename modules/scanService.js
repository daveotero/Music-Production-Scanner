// modules/scanService.js

import { state } from './state.js';
import { elements } from './domElements.js';
import { CACHE_KEYS, DISCOGS_BASE_URL, MAX_ADDITIONAL_VERSIONS_FOR_CREDITS, CREDIT_CATEGORIES, ABBREVIATION_MAP } from './constants.js';
import { log, delay, getArtistCacheKey } from './utils.js';
import { fetchWithRetry } from './apiService.js';
import {
    renderReleases,
    updateErrorPanel,
    updateLastUpdatedText,
    updateLoadingState,
    updateProgress
} from '../app.js';

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
            updateLastUpdatedText(); 
            return;
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

        renderReleases(); 
        updateErrorPanel();

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

    const newItems = []; 
    let page = 1; 
    let hasMore = true;

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
                hasMore = false; 
                break;
            }

            hasMore = data.pagination.pages > 0 && data.pagination.page < data.pagination.pages;

            const pageItems = data.releases
                .filter(release => release.id > maxCachedId) // Made filter more inclusive
                .map(release => ({
                    id: release.id, 
                    title: release.title, 
                    type: release.type,
                    artist_from_list: release.artist, 
                    year_from_list: release.year,
                    thumb_from_list: release.thumb, 
                    role_from_list: release.role
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
    const successfulFetches = []; 
    const failedFetches = []; 
    let completedCount = 0;

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
        let masterApiData = null; 
        let keyReleaseApiData = null; 
        let additionalVersionApiDataArray = [];

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

                    try { 
                        keyReleaseApiData = await fetchWithRetry(`${DISCOGS_BASE_URL}/releases/${keyReleaseId}`); 
                    } catch (keyReleaseError) { 
                        log(`Failed to fetch Key Release ${keyReleaseId} for master ${masterApiData.id}: ${keyReleaseError.message}`, 'warning'); 
                    }
                } else { 
                    log(`Master ${masterApiData.id} does not have a main_release_id.`, 'info'); 
                }

                let keyReleaseHasCredits = keyReleaseApiData ? hasTargetArtistCredits(keyReleaseApiData, state.TARGET_ARTIST_NAME_VARIANTS) : false;

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
                        } catch (versionsError) { 
                            log(`Error fetching versions list for master ${masterApiData.id}: ${versionsError.message}`, 'warning'); 
                        }

                        log(`Identified ${versionIdsToFetch.size} additional unique version(s) to fetch for master ${masterApiData.id}.`);

                        for (const versionId of Array.from(versionIdsToFetch)) {
                            if (state.isScanManuallyStopped) throw new Error("Scan manually stopped before fetching additional version for " + itemInitialData.id);

                            try {
                                log(`Fetching additional version ID: ${versionId} for master ${masterApiData.id}`);
                                await delay(state.requestDelayMs / 2 < 500 ? 500 : state.requestDelayMs / 2);
                                const versionData = await fetchWithRetry(`${DISCOGS_BASE_URL}/releases/${versionId}`);
                                additionalVersionApiDataArray.push(versionData);
                            } catch (versionFetchError) { 
                                log(`Failed to fetch additional version ${versionId} for master ${masterApiData.id}: ${versionFetchError.message}`, 'warning'); 
                            }
                        }
                    }
                } else { 
                    log(`Key Release (ID: ${keyReleaseId}) for master ${masterApiData.id} provided target artist credits. Not fetching additional versions for credits.`, 'info'); 
                }
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
        id: initialItemData.id, 
        title: initialItemData.title, 
        artist: initialItemData.artist_from_list,
        year: initialItemData.year_from_list, 
        label: 'Unknown Label', 
        credits: 'N/A',
        artwork: initialItemData.thumb_from_list || '', 
        discogsUrl: '',
        isMaster: isMaster, 
        type: initialItemData.type, 
        representativeVersionId: null
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

            if (primaryDataSourceForDetails.year) { 
                processed.year = String(primaryDataSourceForDetails.year); 
            }

            if ((!processed.artwork || processed.artwork === initialItemData.thumb_from_list) && primaryDataSourceForDetails.images && primaryDataSourceForDetails.images.length > 0) {
                processed.artwork = primaryDataSourceForDetails.images[0].uri;
            } else if (!processed.artwork && primaryDataSourceForDetails.thumb) {
                processed.artwork = primaryDataSourceForDetails.thumb;
            }

            const allVersionsForCredits = [];
            if (keyReleaseData) allVersionsForCredits.push(keyReleaseData);
            if (additionalVersionDataArray && additionalVersionDataArray.length > 0) {
                allVersionsForCredits.push(...additionalVersionDataArray);
            }

            if (allVersionsForCredits.length > 0) {
                const aggregatedRolesContainer = initializeRolesContainer();

                allVersionsForCredits.forEach(versionData => {
                    if (versionData) {
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
        }
    } else {
        const releaseData = keyReleaseData;

        if (!releaseData) {
            log(`Error: Release data is missing for non-master item ID ${initialItemData.id}. Using initial data.`, 'error');
            processed.discogsUrl = `https://www.discogs.com/release/${initialItemData.id}`;
            processed.credits = 'N/A (Failed to fetch release details)'; 
            return processed;
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
        } else if (releaseData.thumb && !processed.artwork) {
            processed.artwork = releaseData.thumb;
        }

        processed.credits = formatArtistRoles(extractArtistRoles(releaseData, state.TARGET_ARTIST_NAME_VARIANTS));
    }

    return processed;
}

// Enhanced credit parsing functions
function initializeRolesContainer() {
    return {
        production: new Set(),
        engineering: new Set(),
        mixing: new Set(),
        mastering: new Set(),
        vocals: new Set(),
        instruments: new Set(),
        performance: new Set(),
        orchestral: new Set(),
        arrangement: new Set(),
        programming: new Set(),
        technical: new Set(),
        remix: new Set(),
        songwriting: new Set(),
        other: new Set()
    };
}

function preprocessRoleText(roleText) {
    if (!roleText || typeof roleText !== 'string') return '';
    
    let cleaned = roleText.toLowerCase()
        .replace(/\[.*?\]/g, '') // Remove bracketed text like "[Produced By]"
        .replace(/\(.*?\)/g, '') // Remove parenthetical text
        .replace(/[^\w\s-]/g, ' ') // Replace punctuation with spaces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    
    // Handle common abbreviations using the consolidated ABBREVIATION_MAP from constants.js
    Object.entries(ABBREVIATION_MAP).forEach(([abbrev, full]) => {
        const regex = new RegExp(`\\b${abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        cleaned = cleaned.replace(regex, full.toLowerCase()); // Ensure replacement is also lowercase
    });
    
    return cleaned;
}

function categorizeRoleKey(roleText) {
    if (!roleText || typeof roleText !== 'string') return null;
    
    const cleanedRole = preprocessRoleText(roleText);
    if (!cleanedRole) return null;
    
    // Production patterns (highest priority for production roles)
    const productionPatterns = [
        /\bproduc/i, /\bexec.*prod/i, /\bco.*prod/i, /\bassoc.*prod/i,
        /\badditional.*prod/i, /\bvocal.*prod/i, /\bmusic.*prod/i,
        /\bbeat.*prod/i, /\btrack.*prod/i, /\bexecutive.*prod/i
    ];
    
    // Engineering patterns
    const engineeringPatterns = [
        /\bengineer/i, /\brecord/i, /\btrack/i, /\baudio.*eng/i,
        /\bsound.*eng/i, /\bassist.*eng/i, /\badditional.*eng/i,
        /\bco.*eng/i, /\bvocal.*eng/i, /\boverdup.*eng/i,
        /\blive.*eng/i, /\bstudio.*eng/i, /\brecording.*eng/i,
        /\btracking.*eng/i, /\beng.*by/i
    ];
    
    // Mixing patterns
    const mixingPatterns = [
        /\bmix/i, /\bco.*mix/i, /\bassist.*mix/i, /\badditional.*mix/i,
        /\bvocal.*mix/i, /\bfinal.*mix/i, /\bstereo.*mix/i, /\bmixer/i,
        /\bmixed.*by/i, /\bmix.*by/i
    ];
    
    // Mastering patterns
    const masteringPatterns = [
        /\bmaster/i, /\bremaster/i, /\bpre.*master/i, /\bco.*master/i,
        /\bassist.*master/i, /\badditional.*master/i, /\bfinal.*master/i,
        /\bmastered.*by/i, /\bmaster.*by/i, /\bremastered.*by/i
    ];
    
    // Vocal patterns
    const vocalPatterns = [
        /\bvocal/i, /\bsing/i, /\bvoice/i, /\blead.*voc/i, 
        /\bbacking.*voc/i, /\bharmony/i, /\bchoir/i, /\bchorus/i,
        /\bfeaturing/i, /\bguest.*voc/i, /\badditional.*voc/i
    ];
    
    // Instrument patterns
    const instrumentPatterns = [
        /\bguitar/i, /\bbass/i, /\bdrum/i, /\bpiano/i, /\bkeyboard/i,
        /\bsynth/i, /\bpercussion/i, /\belectric.*guitar/i, /\bacoustic.*guitar/i,
        /\blead.*guitar/i, /\brhythm.*guitar/i, /\bbass.*guitar/i,
        /\belectric.*bass/i, /\bupright.*bass/i, /\bdouble.*bass/i,
        /\bdrum.*kit/i, /\bhand.*percussion/i, /\bviolin/i, /\bviola/i,
        /\bcello/i, /\bcontrabass/i, /\bflute/i, /\boboe/i, /\bclarinet/i,
        /\bsaxophone/i, /\btrumpet/i, /\btrombone/i, /\bfrench.*horn/i,
        /\btuba/i, /\bharp/i, /\borgan/i, /\brhodes/i, /\bhammond/i,
        /\bwurltizer/i, /\bmoog/i, /\barp/i, /\bpad/i, /\blead/i,
        /\bstring.*section/i, /\bhorn.*section/i, /\bbacking.*track/i
    ];
    
    // Performance patterns (for featured artists, guest performers, etc.)
    const performancePatterns = [
        /\bperform/i, /\bfeatured/i, /\bguest/i, /\bappears/i, /\bwith/i,
        /\bcourtesy.*of/i, /\bspecial.*guest/i, /\bladditional.*perform/i,
        /\blive.*perform/i, /\bstudio.*perform/i, /\bsolo/i, /\bsoloist/i
    ];
    
    // Orchestral/Classical patterns
    const orchestralPatterns = [
        /\bconductor/i, /\bmusical.*director/i, /\bconcertmaster/i, /\borchestra/i,
        /\bensemble/i, /\bchoir/i, /\bchorus/i, /\bstring.*leader/i,
        /\bsection.*leader/i, /\bprincipal/i, /\bfirst.*chair/i,
        /\bsymphony/i, /\bphilharmonic/i, /\bchamber/i, /\bquartet/i,
        /\bquintet/i, /\boctet/i
    ];
    
    // Arrangement patterns
    const arrangementPatterns = [
        /\barrang/i, /\bstring.*arr/i, /\bhorn.*arr/i, /\bvocal.*arr/i,
        /\borchestrat/i, /\badapted.*by/i, /\badditional.*arrang/i,
        /\breach.*arrang/i, /\bmusical.*arrang/i
    ];
    
    // Programming/Electronic patterns
    const programmingPatterns = [
        /\bprogram/i, /\bbeat.*prog/i, /\bdrum.*prog/i, /\bsynth.*prog/i,
        /\bsequenc/i, /\bsampl/i, /\belectronic.*beat/i, /\bprog.*by/i, /\bloop/i, 
        /\bcomputer.*program/i, /\bmidi.*program/i, /\bmidi/i // Removed /\bdigital.*edit/i
    ];
    
    // Technical support patterns
    const technicalPatterns = [
        /\bassistant/i, /\btape.*operator/i, /\bdigital.*edit/i, /\bpro.*tools.*op/i,
        /\btechnical.*assist/i, /\bsetup/i, /\bmaintenance/i, /\bequipment/i,
        /\btech.*support/i, /\bstudio.*tech/i, /\bassist.*eng/i
    ];
    
    // Remix patterns
    const remixPatterns = [
        /\bremix/i, /\bre.*mix/i, /\bmix.*edit/i, /\badditional.*prod.*remix/i,
        /\bversion/i, /\bedit/i, /\brevision/i
    ];
    
    // Songwriting patterns
    const songwritingPatterns = [
        /\bwriter/i, /\bcompos/i, /\blyric/i, /\bmusic.*by/i, /\bwords.*by/i,
        /\bsong.*writ/i, /\bco.*writ/i, /\badditional.*writ/i, /\bauthor/i,
        /\bcreated.*by/i, /\boriginal.*by/i
    ];
    
    // Check patterns in order of specificity (most specific first)
    // Revised order for improved accuracy
    if (remixPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'remix';
    }
    if (songwritingPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'songwriting';
    }
    if (orchestralPatterns.some(pattern => pattern.test(cleanedRole))) { // Before mastering to catch "Concertmaster" correctly
        return 'orchestral';
    }
    if (arrangementPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'arrangement';
    }
    if (masteringPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'mastering';
    }
    if (mixingPatterns.some(pattern => pattern.test(cleanedRole))) { // After remix
        return 'mixing';
    }
    if (productionPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'production';
    }
    if (engineeringPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'engineering';
    }
    if (programmingPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'programming';
    }
    if (technicalPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'technical';
    }
    if (performancePatterns.some(pattern => pattern.test(cleanedRole))) { // Vocals and Instruments can be forms of performance
        return 'performance';
    }
    if (vocalPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'vocals';
    }
    if (instrumentPatterns.some(pattern => pattern.test(cleanedRole))) {
        return 'instruments';
    }
    
    // If nothing else matches, categorize as 'other'
    return 'other';
}

function extractArtistRoles(releaseData, artistNameVariants) {
    const roles = initializeRolesContainer();
    
    if (!releaseData || (!releaseData.credits && !releaseData.extraartists)) return roles;

    const allCreditsData = [...(releaseData.credits || []), ...(releaseData.extraartists || [])];

    allCreditsData.forEach(credit => {
        const creditNameLower = credit.name ? credit.name.toLowerCase().trim() : '';

        let isTargetArtist = false;
        if (artistNameVariants.length > 0) {
            isTargetArtist = artistNameVariants.some(variant => 
                creditNameLower.includes(variant.toLowerCase())
            );
        } else if (state.currentArtistName) { 
            isTargetArtist = creditNameLower.includes(state.currentArtistName.toLowerCase());
        }

        if (isTargetArtist) {
            const creditRolesText = Array.isArray(credit.role) ? credit.role : (credit.role ? [credit.role] : []);

            creditRolesText.forEach(roleText => {
                // Handle compound roles (e.g., "Producer, Engineer, Mixed By")
                const splitRoles = roleText.split(/[,;&]+/).map(r => r.trim());
                
                splitRoles.forEach(individualRole => {
                    const categoryKey = categorizeRoleKey(individualRole);
                    if (categoryKey && roles[categoryKey]) {
                        // Store standardized version for better display
                        const standardizedRole = standardizeRoleDisplay(individualRole, categoryKey);
                        roles[categoryKey].add(standardizedRole);
                    }
                });
            });
        }
    });

    return roles;
}

function standardizeRoleDisplay(roleText, category) {
    const preprocessed = preprocessRoleText(roleText);
    
    // Enhanced standardization mappings
    const standardizations = {
        // Production
        'producer': 'Producer',
        'executive producer': 'Executive Producer',
        'co producer': 'Co-Producer',
        'associate producer': 'Associate Producer',
        'additional producer': 'Additional Producer',
        'vocal producer': 'Vocal Producer',
        'music producer': 'Music Producer',
        'beat producer': 'Beat Producer',
        
        // Engineering
        'engineer': 'Engineer',
        'recording engineer': 'Recording Engineer',
        'audio engineer': 'Audio Engineer',
        'sound engineer': 'Sound Engineer',
        'tracking engineer': 'Tracking Engineer',
        'assistant engineer': 'Assistant Engineer',
        'co engineer': 'Co-Engineer',
        'additional engineer': 'Additional Engineer',
        
        // Mixing
        'mixed': 'Mixed By',
        'mixing': 'Mixed By',
        'mixer': 'Mixed By',
        'co mixed': 'Co-Mixed',
        'assistant mix': 'Assistant Mix',
        'additional mix': 'Additional Mix',
        
        // Mastering
        'mastered': 'Mastered By',
        'mastering': 'Mastered By',
        'remastered': 'Remastered By',
        'pre mastered': 'Pre-Mastered',
        'co mastered': 'Co-Mastered',
        
        // Vocals
        'vocals': 'Vocals',
        'lead vocals': 'Lead Vocals',
        'backing vocals': 'Backing Vocals',
        'harmony vocals': 'Harmony Vocals',
        'additional vocals': 'Additional Vocals',
        'guest vocals': 'Guest Vocals',
        'featuring': 'Featuring',
        
        // Performance
        'performer': 'Performer',
        'featured artist': 'Featured Artist',
        'guest artist': 'Guest Artist',
        'special guest': 'Special Guest',
        'appears courtesy of': 'Appears Courtesy Of',
        
        // Arrangement
        'arranger': 'Arranger',
        'string arranger': 'String Arranger',
        'horn arranger': 'Horn Arranger',
        'vocal arranger': 'Vocal Arranger',
        'orchestrator': 'Orchestrator',
        
        // Programming
        'programmer': 'Programmer',
        'beat programmer': 'Beat Programmer',
        'drum programming': 'Drum Programming',
        'synthesizer programming': 'Synthesizer Programming',
        
        // Orchestral
        'conductor': 'Conductor',
        'musical director': 'Musical Director',
        'concertmaster': 'Concertmaster',
        'orchestra': 'Orchestra',
        'ensemble': 'Ensemble',
        
        // Songwriting
        'writer': 'Writer',
        'composer': 'Composer',
        'lyricist': 'Lyricist',
        'songwriter': 'Songwriter',
        
        // Common variations
        'recorded': 'Recorded By',
        'recording': 'Recorded By',
        'tracked': 'Tracked By',
        'tracking': 'Tracked By'
    };
    
    if (standardizations[preprocessed]) {
        return standardizations[preprocessed];
    }
    
    // Then, check against standard roles for the category (more general match)
    if (CREDIT_CATEGORIES[category] && CREDIT_CATEGORIES[category].standardRoles) {
        // Sort standard roles by length (descending) to match more specific roles first
        // e.g., "Additional Producer" before "Producer"
        const sortedStandardRoles = [...CREDIT_CATEGORIES[category].standardRoles].sort((a, b) => b.length - a.length);
        
        for (const standardRole of sortedStandardRoles) {
            if (preprocessed.includes(standardRole.toLowerCase())) {
                return standardRole; // Return the display version from constants
            }
        }
    }
    
    // If in 'other' category and preserveOriginal is true, return cleaned original
    if (category === 'other' && CREDIT_CATEGORIES.other?.preserveOriginal) {
        return toTitleCase(roleText.trim());
    }
    
    // Default: return title case version
    return toTitleCase(roleText.trim());
}

function toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => 
        txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
}

function formatArtistRoles(rolesObject) {
    const summaryCredits = [];
    
    // Get categories sorted by priority from constants
    const sortedCategories = Object.entries(CREDIT_CATEGORIES)
        .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99))
        .map(([key, config]) => ({ 
            key, 
            summaryTerm: config.summaryTerm 
        }));

    sortedCategories.forEach(catInfo => {
        if (rolesObject[catInfo.key] && rolesObject[catInfo.key].size > 0 && catInfo.summaryTerm) {
            summaryCredits.push(catInfo.summaryTerm);
        }
    });
    return summaryCredits.length > 0 ? summaryCredits.join(', ') : 'N/A';
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

    if (state.isScanManuallyStopped) { 
        log('Retry process stopped by user. Partially processed data handled.', 'warning'); 
    } else { 
        log(`Successfully retried ${successful.length} items, ${stillFailedAfterRetry.length} still failed.`); 
    }

    await localforage.setItem(getArtistCacheKey(CACHE_KEYS.RELEASES_PREFIX), state.releases);
    await localforage.setItem(getArtistCacheKey(CACHE_KEYS.FAILED_QUEUE_PREFIX), state.failedQueue);

    renderReleases(); 
    updateErrorPanel();
}

export async function retrySingleItem(id, type) {
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
            retryBtn.innerHTML = ' Retrying...';
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
        renderReleases();
        updateErrorPanel();

        if (!wasAlreadyLoading || state.isScanManuallyStopped) { 
            state.isLoading = false; 
            updateLoadingState(false);
        } else { 
            updateLoadingState(true, 'Scan in progress...'); 
        }
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
