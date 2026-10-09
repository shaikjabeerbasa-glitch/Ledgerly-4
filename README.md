# Ledgerly

A single-page finance manager using vanilla HTML, CSS and JavaScript. Native canvas charts need no CDN or application dependencies.

## Run

1. Extract the entire ZIP, keeping the `js` folder alongside `index.html`.
2. Open the Ledgerly folder in VS Code and use Live Server, or run `python3 -m http.server 8000` in that folder.
3. Open `http://localhost:8000`.

Use an HTTP server rather than double-clicking index.html: browsers restrict ES modules on file URLs.

## Features and behavior

- Accounts, transactions, categories, monthly budgets and recurring rules support create, read, update and delete.
- Transfers are two linked records. Editing either side preserves the original direction; changing transaction type removes the old pair. Deleting either side, including through bulk deletion, removes both.
- Deleting an account removes its transactions, their transfer peers and its recurring rules. Deleting a category removes its children and their budgets/rules; historical transactions remain uncategorized.
- Category nesting is limited to one parent and one child level. Parent budgets include child spending. Budgets are unique per category and month; yellow begins at 80%, red when spending exceeds the limit.
- Recurring income/expenses catch up when opened. Processed dates and transaction provenance prevent duplicates. Monthly schedules retain their original day, clamping to February/month-end as needed. Generated entries and rule changes share one undo action.
- Transactions combine date/account/category/type/amount/text filters, sorting by up to three columns, pagination, selection, bulk deletion and recategorization. Clicking a sort heading moves it to first priority and toggles its direction. Filters, sort and page persist across reload; applying filters clears selection.
- Undo/redo keeps the last 20 changes during the current session. Undo/Redo disable when their stacks are empty. A change from another tab clears stale history. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z work outside text fields; text fields retain their native editing shortcuts.
- CSV import maps columns, validates every row and shows all errors. No rows are imported until all rows are valid. CSV export includes each transfer once. Quoted commas, multiline fields, escaped quotes and UTF-8 BOM are supported.
- JSON backups validate account/category references, IDs, amounts, dates, transfer pairs, budgets and recurring intervals before replacement. Invalid backups leave current data unchanged.
- localStorage persists data. Corrupt saved bytes are retained under `ledgerly-state-v1-corrupt-backup` before defaults load. Storage failures show a notice to export a backup.
- Hash routes support browser back/forward. Theme, keyboard controls, modal focus management, accessible chart descriptions and responsive layouts are included.
- USD/INR selects the unit for the stored amounts; it does not perform foreign-exchange conversion. All accounts share that unit.

New visits follow the system theme; saved preferences take precedence. Multiple tabs synchronize data and coordinate writes with Web Locks where supported.

The app starts with demo records. Settings → Reset all data gives an empty workspace. Export a backup before deleting your own financial data.

## Verification

Install Node 24, then run:

```bash
npm ci
npm test
npx playwright install
npm run test:e2e
```

For Chromium only: `npm run test:e2e -- --project=chromium`.
For headed inspection: `npm run test:e2e -- --project=chromium --headed`.
For the interactive runner: `npm run test:e2e:ui`.
For explicit screenshot comparisons: `npm run test:e2e:visual`.
To create/review baselines for your OS and browser version: `npm run test:e2e:update`.

The suite tests all 15 reference groups. It includes Chromium, Firefox, WebKit and mobile Chrome projects, controlled clocks, storage seeding, per-test page-error checks, axe audits, screenshots and HTML/JSON reports. Playwright starts a local Python HTTP server automatically (Python 3 required). Set `LEDGERLY_BASE_URL` to test a deployment instead. All tests use seeded demo records, never your normal profile.

Browser defaults and ambiguities are documented in [behavior-and-coverage.md](docs/behavior-and-coverage.md). The original reference is included under `docs/`.


Use Node 24 for the development tests. All npm packages are development-only; the app itself uses no libraries.

Core tests cover integrity validation, backups, corrupt storage, category nesting, CSV, budgets and filtering/sorting. DOM integration checks cover all CRUD forms, linked transfers and conversion, undo/redo, recurring duplicate prevention and month-end dates, CSV import/errors, bulk actions and deletion cascades.

See [verification-results.md](docs/verification-results.md) for browser results and verification limits.

## Replace your previous version

Back up your existing project folder and export your financial data from Settings. Replace the whole project with this ZIP’s `Ledgerly` folder, including all files under `js/` (especially the new `money.js`). Open this folder in VS Code and start Live Server from `index.html`. Use the same host and port to retain existing browser localStorage; a different origin requires importing your JSON backup.
