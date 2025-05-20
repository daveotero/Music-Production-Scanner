// modules/state.js
import { NO_TOKEN_DELAY_MS } from './constants.js';

export const state = {
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
  settingsVisible: true,
  requestDelayMs: NO_TOKEN_DELAY_MS,
  isModalOpen: false,
  TARGET_ARTIST_NAME_VARIANTS: []
};

export function updateTargetArtistNameVariants(newVariants) {
    state.TARGET_ARTIST_NAME_VARIANTS = newVariants;
}