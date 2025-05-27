# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (loosely, during alpha).

## [0.2.1-alpha] - 2025-05-24

### Changed
- **Credit Display:** Updated `formatArtistRoles` to output a concise summary of artist contributions (e.g., "Produced, Engineered, Mixed") rather than the previous detailed hierarchical list.
- **Release Fetching:** Modified `getNewArtistItems` in `scanService.js` to be more inclusive, fetching a broader range of an artist's releases from Discogs to better match their main artist page.
- **Credit Completeness:** Increased the `MAX_ADDITIONAL_VERSIONS_FOR_CREDITS` constant from 3 to 5. This allows the scanner to check more versions of a master release for credits if the primary version lacks them, aiming for more comprehensive credit aggregation.

### Improved
- **Credit Parsing:**
  - Further refined the order of pattern matching in `categorizeRoleKey` for more accurate role categorization (e.g., "Concertmaster" vs. "Mastering", "Remix" vs. "Mixing").
  - Streamlined `standardizeRoleDisplay` logic for more robust mapping of varied role text to canonical display names.
  - Ensured `ABBREVIATION_MAP` in `constants.js` is the single source of truth for all abbreviation expansions.

### Docs
- Added "Advanced Settings / Configuration Details" section to README.md to explain constants like `MAX_ADDITIONAL_VERSIONS_FOR_CREDITS`.
- **UI:** Application version number is now displayed in the footer of the main page.

## [0.2.0-alpha] - 2025-05-22

### Added
- **Enhanced Credit Processing:**
  - Expanded role categorization from a few hardcoded types to a dynamic system supporting 15+ categories (e.g., Production, Engineering, Mixing, Mastering, Vocals, Instruments, Remix, Songwriting).
  - Implemented `CREDIT_CATEGORIES` constant to define display names, priority, and standard roles for each category.
  - Introduced `ABBREVIATION_MAP` to handle common abbreviations in credit roles (e.g., "prod" -> "Producer").
  - New function `categorizeRoleAdvanced` for comprehensive pattern matching and subcategory identification.
  - New function `expandAbbreviations` to normalize role text.
  - Updated `extractArtistRoles` to use the new dynamic category system.
  - Updated `formatArtistRoles` for hierarchical display with standard roles listed first and categories grouped by priority. Output format changed from semicolon-separated to pipe-separated (` | `) groups.

### Changed
- Moved `CREDIT_CATEGORIES` and `ABBREVIATION_MAP` from `scanService.js` to `modules/constants.js` for better organization and potential reusability.
- Updated spinner icon for the "Retry now" button in the error panel to use Font Awesome (`<i class="fa fa-spinner fa-spin"></i>`) for a more consistent UI.

### Fixed
- Ensured Font Awesome library is linked in `index.html` to correctly render the new spinner icon.

## [0.1.0-alpha] - 2025-05-20
- Initial alpha release with core scanning, caching, and display functionality.