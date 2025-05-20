# **Music Production Scanner**

## **Overview**

The **Music Production Scanner** is a web-based tool designed to help users, particularly those in music production or A\&R, quickly find and consolidate production credits for a specific artist by leveraging the extensive **Discogs database**. It fetches release information, processes master and version data, and intelligently aggregates credits to provide a comprehensive overview of an artist's production work (Produced, Engineered, Mixed, Mastered).

The application is built with vanilla JavaScript, HTML, and CSS, utilizing Bootstrap for some basic styling and layout components, and localforage for client-side caching of fetched data.

## **Purpose / Why This App?**

Discogs is an invaluable resource for music information, but consolidating detailed production credits for a specific artist can be challenging. Master releases (which group various versions of an album or single) often don't display the granular credit information. These crucial details are typically nested within specific versions of a release and can be inconsistently organized or incomplete across different pressings.

This application was created to address these challenges by:

* Identifying master releases associated with a particular artist on Discogs.  
* Intelligently "diving deeper" into the versions of those master releases to find specific production credits.  
* Aggregating these credits from multiple versions where necessary to build the most complete picture.  
* Organizing and presenting this information to the user in a clean, uniform, and easily digestible manner.

Essentially, it automates the often tedious process of hunting down and compiling comprehensive production credit lists from Discogs.

## **Features**

* **Artist-Specific Scanning:** Fetches all relevant releases for a given Discogs Artist ID.  
* **Intelligent Master/Release Handling:**  
  * Identifies master releases and their corresponding "key" (main) versions from Discogs.  
  * Prioritizes the key release for primary data (title, artist, label, year, artwork).  
  * Conditionally fetches additional versions of a master release *only if* the key release does not provide production credits for the target artist, optimizing API calls.  
  * Aggregates production credits (Produced, Engineered, Mixed, Mastered) from the key release and any additionally fetched versions to build the most complete credit list.  
* **Deduplication:** Presents a clean, deduplicated list of an artist's works, ensuring that if a master release is displayed (with its aggregated data), its individual versions are not shown separately if they are already represented.  
* **Dynamic Rate Limiting:** Adjusts the delay between Discogs API requests based on the presence of a user-provided Discogs Personal Access Token:  
  * With Token: 1.1 seconds per request (approx. 54 requests/minute).  
  * Without Token: 3 seconds per request (20 requests/minute).  
* **Client-Side Caching:** Uses localforage to cache fetched release data, scan status, and user settings in the browser, reducing redundant API calls on subsequent visits for the same artist.  
* **Incremental Updates:** When re-scanning, only fetches releases newer than the latest cached release for the current artist.  
* **Error Handling & Retries:**  
  * Handles API errors, including rate limiting (429 errors), with automatic retries and exponential backoff.  
  * Displays failed requests in a separate panel with an option to retry individual items or all failed items.  
* **User Interface:**  
  * Clear input fields for Discogs Artist ID and Personal Access Token.  
  * Progress bar and status updates during scans.  
  * Sortable data grid for displaying fetched releases.  
  * In-page modal for viewing larger artwork images (closable with 'X' button or Escape key).  
  * Collapsible log panel to view detailed application activity.  
  * Collapsible error panel for managing failed requests.  
  * Offline status indicator.  
* **Data Export:** Allows users to export the scanned and processed data to a CSV file.  
* **Cache Management:** Option to clear all cached data for the currently selected artist.  
* **Flexible Artist ID Input:** Accepts both plain numeric Discogs Artist IDs (e.g., 305403\) and the format copied from Discogs URLs (e.g., \[a305403\]).  
* **Clickable Artist Name:** The main heading dynamically links to the artist's page on Discogs once an artist is successfully loaded.

## **Getting Started**

This is a client-side web application. To run it, you simply need a modern web browser.

### **Prerequisites**

* A modern web browser (e.g., Chrome, Firefox, Safari, Edge).  
* Internet connection (for fetching data from Discogs).

### **Files**

The application is structured into a main application file and several smaller modules for better organization and maintainability.

*   `index.html`: The main HTML structure of the application.
*   `style.css`: Contains all the custom styles and theme information.
*   `app.js`: The main application file. It handles initialization, user settings, event listeners, UI updates, and orchestrates calls to the various service modules.

The core logic is broken down into modules located in the `./modules` directory:

*   `./modules/constants.js`: Defines application-wide constants (API URLs, cache keys, delays, etc.).
*   `./modules/domElements.js`: Centralizes the selection of key DOM elements.
*   `./modules/state.js`: Manages the application's global state object and related state-updating functions.
*   `./modules/utils.js`: Contains generic utility functions (logging, HTML escaping, delays, name variant generation, cache key generation).
*   `./modules/apiService.js`: Handles direct interactions with the Discogs API, including the retry logic for fetches.
*   `./modules/scanService.js`: Contains the core logic for fetching artist items, processing release/master details, aggregating credits, deduplicating data, and managing the retry queue.

This modular structure helps separate concerns, making the code easier to read, test, and maintain.

## **Installation / Setup**

1. Download the index.html, style.css, and app.js files.  
2. Place them in the same directory on your local machine.  
3. Open the index.html file in your web browser.

No server-side setup or complex build process is required for the basic functionality.

## **Usage**

1. **Open index.html in your browser.**  
2. **Enter Discogs Artist ID:**  
   * In the "Discogs Artist ID" field, enter the numeric ID of the artist you want to scan (e.g., 305403).  
   * You can also paste the ID in the format \[a305403\] (as copied from some Discogs URLs). The application will parse it automatically.  
3. **Enter Discogs Personal Access Token (Recommended):**  
   * To benefit from higher API rate limits (60 requests/minute vs. 25 without a token), generate a Personal Access Token from your Discogs account settings: [Discogs Developer Settings](https://www.discogs.com/settings/developers).  
   * Enter this token into the "Discogs Personal Access Token" field.  
   * The token is stored locally in your browser's localforage storage and is not transmitted anywhere else.  
4. **Save Settings:** Click the "Save Settings" button. This will:  
   * Validate and parse the Artist ID.  
   * Fetch the artist's name from Discogs to update the page title.  
   * Store your Artist ID and Token in local browser storage for future sessions.  
   * Set the appropriate API request delay based on token presence.  
   * Load any cached data for this artist.  
5. **Start Scan:** Click the "Start Scan" button.  
   * The application will first attempt to retry any previously failed requests for this artist.  
   * Then, it will fetch new releases for the artist from Discogs.  
   * Progress will be shown via a progress bar and status messages.  
   * Fetched releases will be displayed in the table.  
6. **Interact with Data:**  
   * **Sort:** Click on table headers (Artist, Album, Label, Year, Credits) to sort the data.  
   * **View Artwork:** Click on an artwork thumbnail in the table to view a larger version in an in-page modal. Close the modal by clicking the 'X' button, pressing the 'Escape' key, or clicking on the modal backdrop.  
   * **View on Discogs:** Click on the album title to open the release/master page on Discogs in a new tab. The main artist name in the heading also links to the artist's Discogs page.  
7. **Stop Scan:** During an active scan, a "Stop Scan" button will appear. Clicking this will halt the scanning process at the next available check.  
8. **Export CSV:** Click "Export CSV" to download the currently displayed data as a CSV file.  
9. **Clear Cache:** Click "Clear Cache" to remove all stored data (releases, failed items, last updated timestamp) for the *current artist* from your browser's local storage. User settings (Artist ID, Token) are not cleared by this button.  
10. **Log & Error Panels:** Use the "Hide/Show" buttons to toggle the visibility of the detailed log panel and the failed requests panel.

## **Configuration**

* **Artist ID:** The Discogs numerical ID for an artist.  
* **Discogs Personal Access Token:** Your personal token from Discogs for authenticated API access. This increases the rate limit from 25 to 60 requests per minute. The application will function without a token but at a slower pace (3-second delay between requests vs. 1.1-second with a token).

These settings are saved locally in your browser via localforage.

## **How It Works (Briefly)**

1. **Initial Setup:** User provides Artist ID and (optionally) a Discogs token. These are saved.  
2. **Artist Data Fetch:** The artist's name is fetched from Discogs to personalize the UI.  
3. **Caching:** Previously fetched data for an artist is loaded from localforage.  
4. **Scanning Process:**  
   * **Retry Failed:** Attempts to re-fetch any items that failed in previous scans for the current artist.  
   * **Fetch New Items:** Makes paginated calls to the Discogs API (/artists/{artist\_id}/releases) to get a list of the artist's works. It only fetches items with IDs greater than the highest ID already cached for that artist (incremental update).  
   * **Item Detail Fetching (fetchAndProcessItemDetails):**  
     * For each new item:  
       * If it's a **Master Release** (type: "master"):  
         1. Fetches the master data from /masters/{master\_id}.  
         2. Identifies the main\_release (Key Release) ID from the master data.  
         3. Fetches the Key Release data from /releases/{key\_release\_id}.  
         4. Checks if the Key Release contains any production credits for the target artist (using hasTargetArtistCredits).  
         5. If **no credits** are found in the Key Release, it fetches up to MAX\_ADDITIONAL\_VERSIONS\_FOR\_CREDITS (e.g., 2\) other versions from the master's versions list (/masters/{master\_id}/versions).  
         6. The processApiData function then combines information:  
            * Master data for overall title, artist, master year.  
            * Key Release data (if available) for specific label, year, artwork.  
            * Aggregates production credits from *all* fetched versions (Key Release \+ any additional versions).  
       * If it's a **Specific Release** (type: "release"):  
         1. Fetches the release data directly from /releases/{release\_id}.  
         2. processApiData extracts details and credits from this single release.  
   * **Data Processing (processApiData, extractArtistRoles, formatArtistRoles):**  
     * Extracts relevant fields (artist, title, label, year, artwork URL).  
     * Parses the credits and extraartists arrays to identify production roles (Produced, Engineered, Mixed, Mastered) performed by the target artist.  
     * Formats these roles into a readable string.  
   * **Deduplication (deduplicateReleases):** After processing a batch of items, this function ensures that if a master release is in the list (which now contains aggregated data from its representative version), the specific release that was chosen as its representative is not also listed as a separate, redundant entry.  
   * **Display & Caching:** Processed items are added to the state.releases array, cached using localforage, and rendered in the UI table.  
5. **Rate Limiting:** A delay (state.requestDelayMs) is enforced between primary API calls. This delay is dynamically set based on the presence of a Discogs token. Sub-fetches (like fetching versions for a master) use a shorter, fixed delay.  
6. **Error Handling:** API errors are caught, logged, and failing items are added to a failedQueue for potential retry. 429 (rate limit) errors trigger an automatic wait and retry.

## **Styling**

* The application uses **Bootstrap 5.3** for its foundational layout, grid system, and some component styling (like buttons, progress bar, alerts).  
* Custom styles are defined in style.css to:  
  * Implement a light/dark theme based on user's system preference or a data-color-scheme attribute.  
  * Override Bootstrap defaults where necessary.  
  * Style custom components like cards, sortable table headers, artwork thumbnails, and the artwork modal.  
  * Define a color palette and typography using CSS custom properties (variables).

## **Future Enhancements / To-Do (Potential)**

* **Advanced Filtering:** Allow users to filter the displayed results by year, label, or credit type.  
* **More Sophisticated Version Selection:** For masters, implement more advanced heuristics for choosing which versions to fetch for credit aggregation (e.g., based on country, format popularity, "official" status).  
* **User-Configurable Delays:** Allow users to set custom API request delays.  
* **Full "Clear All Data":** Option to clear all application data from localforage, not just for the current artist.  
* **Modularization:** Refactor app.js into smaller, more manageable ES6 modules (would require a build step or careful native module implementation).  
* **Testing:** Implement unit and integration tests.

## **License**

This project is currently unlicensed. (Or specify a license, e.g., MIT License).