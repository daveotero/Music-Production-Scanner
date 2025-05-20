// modules/constants.js

export const CACHE_KEYS = {
  RELEASES_PREFIX: 'releases_',
  LAST_UPDATED_PREFIX: 'lastUpdated_',
  FAILED_QUEUE_PREFIX: 'failedQueue_',
  USER_SETTINGS: 'userSettings'
};
export const DISCOGS_BASE_URL = 'https://api.discogs.com';
export const TOKEN_PRESENT_DELAY_MS = 1100; // Delay if Discogs token is present
export const NO_TOKEN_DELAY_MS = 3000;    // Delay if no Discogs token
// Fetch up to this many *additional* versions if key release lacks credits for the target artist.
export const MAX_ADDITIONAL_VERSIONS_FOR_CREDITS = 2;