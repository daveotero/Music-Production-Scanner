# **Music Production Scanner**

## **Overview**

The **Music Production Scanner** is a web-based tool designed to help users, particularly those in music production or A\&R, quickly find and consolidate production credits for a specific artist by leveraging the extensive **Discogs database**. It fetches release information, processes master and version data, and intelligently aggregates credits to provide a comprehensive overview of an artist's production work (Produced, Engineered, Mixed, Mastered).

The application is built with vanilla JavaScript, HTML, and CSS, utilizing Bootstrap for some basic styling and layout components, and localforage for client-side caching of fetched data.

## **Why Did I Build This?**

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
  * Conditionally fetches additional versions (up to **5**, defined by `MAX_ADDITIONAL_VERSIONS_FOR_CREDITS`) of a master release *only if* the key release does not provide production credits for the target artist, optimizing API calls.
  * Aggregates production credits from the key release and any additionally fetched versions to build the most complete credit list.
* **Deduplication:** Presents a clean, deduplicated list of an artist's works, ensuring that if a master release is displayed (with its aggregated data), its individual versions are not shown separately if they are already represented.
* **Dynamic Rate Limiting:** Adjusts the delay between Discogs API requests based on the presence of a user-provided Discogs Personal Access Token:
  * With Token: 1.1 seconds per request (approx. 54 requests/minute).
  * Without Token: 3 seconds per request (20 requests/minute).
* **Summarized Credit Display:** Presents a concise summary of an artist's involvement (e.g., "Produced, Engineered, Mixed, Mastered") for each release, providing a quick overview.
* **Comprehensive Release Fetching:** Gathers a broader range of an artist's appearances and contributions from Discogs, aiming to include items beyond just their main releases.
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
* **Data Import:** Allows users to import production credit data from a CSV file. This feature is particularly useful for:
  * **Large Catalogs**: Users can pre-populate the application with extensive data without needing to perform a full initial scan.
  * **Offline Data Management**: Data can be curated or modified offline in a CSV editor and then imported back into the application.
  * **Data Seeding**: Quickly set up the application with known data, bypassing initial API interactions for that dataset.
* **Cache Management:** Option to clear all cached data for the currently selected artist.
* **Flexible Artist ID Input:** Accepts both plain numeric Discogs Artist IDs (e.g., 305403) and the format copied from Discogs URLs (e.g., [a305403]).
* **Clickable Artist Name:** The main heading dynamically links to the artist's page on Discogs once an artist is successfully loaded.

## **Getting Started (Using the Web App)**

The easiest way to use the Music Production Scanner is by visiting the hosted version on GitHub Pages. This is a client-side web application that runs directly in your browser.

**[Access the Music Production Scanner Here](https://daveotero.github.io/Music-Production-Scanner/)**

Simply open the link in a modern web browser with an internet connection to start using the application.

## **Running Locally (For Developers)**

If you wish to run the application code locally for development or testing, you will need a local web server. Due to browser security restrictions with local file access (`file:///`) for JavaScript modules, opening the `index.html` file directly from your computer will likely not work.

To run locally:

1. Clone or download the repository.
2. Serve the project directory using a local web server (e.g., Python's `http.server`, Node.js's `http-server` or `live-server`).
3. Open the local server address (e.g., `http://localhost:8000`) in your browser.

## **Usage**

1. **Open the application in your browser** (preferably via the hosted link).
2. **Enter Discogs Artist ID:**
   * In the "Discogs Artist ID" field, enter the numeric ID of the artist you want to scan (e.g., 305403).
   * You can also paste the ID in the format [a305403] (as copied from some your Discogs artist page). The application will parse it automatically.
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
9. **Import CSV:** Click "Import CSV" to select a CSV file from your computer. The file must match the format of exported CSVs. This will overwrite existing data for the current artist.
10. **Clear Cache:** Click "Clear Cache" to remove all stored data (releases, failed items, last updated timestamp) for the *current artist* from your browser's local storage. User settings (Artist ID, Token) are not cleared by this button.
11. **Log & Error Panels:** Use the "Hide/Show" buttons to toggle the visibility of the detailed log panel and the failed requests panel.

## **Configuration**

* **Artist ID:** The Discogs numerical ID for an artist.
* **Discogs Personal Access Token:** Your personal token from Discogs for authenticated API access. This increases the rate limit from 25 to 60 requests per minute. The application will function without a token but at a slower pace (3-second delay between requests vs. 1.1-second with a token).

These settings are saved locally in your browser via localforage.

## **Structure**

The application is structured into a main application file and several smaller modules for better organization and maintainability.

* [`index.html`](index.html): The main HTML structure of the application.
* [`style.css`](style.css): Contains all the custom styles and theme information.
* [`app.js`](app.js): The main application file. It handles initialization, user settings, event listeners, UI updates, and orchestrates calls to the various service modules.

The core logic is broken down into modules located in the `./modules` directory:

* [`./modules/constants.js`](modules/constants.js): Defines application-wide constants (API URLs, cache keys, delays, etc.).
* [`./modules/domElements.js`](modules/domElements.js): Centralizes the selection of key DOM elements.
* [`./modules/state.js`](modules/state.js): Manages the application's global state object and related state-updating functions.
* [`./modules/utils.js`](modules/utils.js): Contains generic utility functions (logging, HTML escaping, delays, name variant generation, cache key generation).
* [`./modules/apiService.js`](modules/apiService.js): Handles direct interactions with the Discogs API, including the retry logic for fetches.
* [`./modules/scanService.js`](modules/scanService.js): Contains the core logic for fetching artist items, processing release/master details, aggregating credits, deduplicating data, and managing the scan lifecycle and retry queue.
* [`./modules/importService.js`](modules/importService.js): Handles the parsing and validation of imported CSV data.

This modular structure helps separate concerns, making the code easier to read, test, and maintain.

## **How It Works (Overview)**

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
         4. Checks if the Key Release contains any production credits for the target artist (using `hasTargetArtistCredits`).
         5. If **no credits** are found in the Key Release, it fetches up to `MAX_ADDITIONAL_VERSIONS_FOR_CREDITS` (currently **5**) other versions from the master's versions list (/masters/{master\_id}/versions).
         6. The processApiData function then combines information:
            * Master data for overall title, artist, master year.
            * Key Release data (if available) for specific label, year, artwork.
            * Aggregates production credits from *all* fetched versions (Key Release + any additional versions).
       * If it's a **Specific Release** (type: "release"):
         1. Fetches the release data directly from /releases/{release\_id}.
         2. processApiData extracts details and credits from this single release.
   * **Data Processing (`processApiData`, `extractArtistRoles`, `formatArtistRoles`):**
     * Extracts relevant fields (artist, title, label, year, artwork URL).
     * Parses the `credits` and `extraartists` arrays to identify roles performed by the target artist across various categories.
     * Formats these roles into a concise, summarized string (e.g., "Produced, Engineered, Mixed").
   * **Deduplication (deduplicateReleases):** After processing a batch of items, this function ensures that if a master release is in the list (which now contains aggregated data from its representative version), the specific release that was chosen as its representative is not also listed as a separate, redundant entry.
   * **Display & Caching:** Processed items are added to the state.releases array, cached using localforage, and rendered in the UI table.
5. **Rate Limiting:** A delay (state.requestDelayMs) is enforced between primary API calls. This delay is dynamically set based on the presence of a Discogs token. Sub-fetches (like fetching versions for a master) use a shorter, fixed delay.
6. **Error Handling:** API errors are caught, logged, and failing items are added to a failedQueue for potential retry. 429 (rate limit) errors trigger an automatic wait and retry.

## **Styling**

* The application uses **Bootstrap 5.3** for its foundational layout, grid system, and some component styling (like buttons, progress bar, alerts).
* Custom styles are defined in [`style.css`](style.css) to:
  * Implement a light/dark theme based on user's system preference or a data-color-scheme attribute.
  * Override Bootstrap defaults where necessary.
  * Style custom components like cards, sortable table headers, artwork thumbnails, and the artwork modal.
  * Define a color palette and typography using CSS custom properties (variables).

## Advanced Settings / Configuration Details

While most settings are managed through the UI, some internal constants control specific behaviors. Developers modifying the source code can adjust these:

*   **`MAX_ADDITIONAL_VERSIONS_FOR_CREDITS`**:
    *   **Purpose**: This constant (defined in `modules/constants.js`) determines the maximum number of additional versions of a master release the scanner will attempt to fetch and process if the primary "key release" for that master does not contain credits for the target artist.
    *   **Default Value**: `5`
    *   **Impact**:
        *   A higher value increases the likelihood of finding comprehensive credits, especially for master releases with many versions where credits might be scattered. However, it can also lead to more API calls to Discogs and potentially longer scan times.
        *   A lower value will result in faster scans but might miss credits if they are not present in the key release or the first few additional versions checked.
    *   **Note**: This setting is currently not user-configurable through the UI and requires a code change to modify its value in `modules/constants.js`.

## **Future Enhancements / To-Do**

* **User-Configurable Settings:** Explore making constants like `MAX_ADDITIONAL_VERSIONS_FOR_CREDITS` configurable via the UI.
* **Detailed Credit View Toggle:** Option to switch between the summarized credit view and a more detailed, categorized view for each release.

## **Created By**

This tool was created by **Dave Otero**, a music producer and mixing engineer at [Flatline Audio](https://flatlineaudio.com) in Denver, Colorado. 🤘

You can check out his production credits on [Muso.AI](https://credits.muso.ai/profile/57c9077d-c4b1-4bbc-b057-0ac2231968eb).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/S6S41FAAEJ)
## **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
