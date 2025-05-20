// modules/utils.js
import { elements } from './domElements.js';
import { state } from './state.js';

export function log(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  // Correctly call the appropriate console method
  if (level === 'error') {
    console.error(logEntry);
  } else if (level === 'warning') {
    console.warn(logEntry);
  } else {
    console.info(logEntry);
  }

  if (elements.log) {
    const currentLogContent = elements.log.textContent;
    // Prepend new log entry
    elements.log.textContent = `${logEntry}\n${currentLogContent}`;

    // Trim log to max lines
    const maxLogLines = 200; // Configurable: max number of lines to keep in the UI log
    const lines = elements.log.textContent.split('\n');
    if (lines.length > maxLogLines) {
        elements.log.textContent = lines.slice(0, maxLogLines).join('\n');
    }
  }
}

export function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function delay(ms) {
  return new Promise(resolve => {
    if (state.isScanManuallyStopped) { // Check if scan was stopped during a pending delay
        log('Delay cancelled due to manual stop.', 'info');
        resolve(); // Resolve immediately if stopped
        return;
    }
    setTimeout(resolve, ms);
  });
}

export function generateNameVariants(artistName) {
    if (!artistName) return [];
    const nameLower = artistName.toLowerCase();
    const variants = new Set([nameLower, artistName]); // Include original case and lowercase
    // Example: "The Beatles" -> "beatles"
    if (nameLower.startsWith("the ")) {
        variants.add(nameLower.substring(4));
    }
    // Add more variants as needed, e.g., removing punctuation, handling "and" vs "&"
    return Array.from(variants);
}

export function getArtistCacheKey(prefix) {
    if (!state.currentArtistId) {
        log("Artist ID not set for cache key generation.", "warning");
        throw new Error("Artist ID not set for cache key generation.");
    }
    return `${prefix}${state.currentArtistId}`;
}