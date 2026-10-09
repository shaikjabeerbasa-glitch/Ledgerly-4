# Ledgerly: 15 High-Value Playwright Scenarios

App under test: https://ledgerly-dusky-pi.vercel.app/

These scenarios come from exploring the live app (UI, DOM, localStorage and the shipped ES modules). They go beyond "click button, see text" and target the places where a finance app can actually break: money math, state consistency, data loss, and accessibility.

---

## 0. Facts about the app you can build on

| Fact | Why it matters for tests |
|---|---|
| State lives in `localStorage` under `ledgerly-state-v1` | You can seed, corrupt, or inspect state directly with `addInitScript` and `page.evaluate` |
| Corrupt data is copied to `ledgerly-state-v1-corrupt-backup` | You can assert on the recovery path |
| Hash routes: `#/dashboard`, `#/accounts`, `#/transactions`, `#/budgets`, `#/categories`, `#/recurring`, `#/settings` | Deep linking and back/forward tests |
| Forms: `#account-form`, `#transaction-form`, `#budget-form`, `#category-form`, `#recurring-form`, `#transaction-filter-form`, `#csv-mapping-form` | Stable locators |
| Row actions use `data-action="edit-transaction"`, `"delete-transaction"` and similar, plus `data-id` | Precise row targeting |
| Transfers are stored as **two** transactions sharing a `transferGroupId`, with `transferSide` of `source` or `destination` | Core invariant to protect |
| Sort state is a stack (`ui.sort`) of up to 3 keys | Multi-column sort tests |
| Recurring rules keep `processedDates` and `anchorDay` | Duplicate-prevention tests |
| Charts are `<canvas>` (`#categoryChart`, `#trendChart`) with an `aria-label` and text legends | Assert on the label and legend, not pixels |
| Budget bar classes: `progress-fill`, `.warning`, `.danger` | Threshold assertions |

### Suggested project setup

```
tests/
  fixtures/
    app.ts            # extends test with: seededPage, state helpers
    seeds.ts          # builders: account(), txn(), budget(), recurring()
  pages/
    TransactionsPage.ts
    BudgetsPage.ts
    SettingsPage.ts
  specs/
    01-transfers.spec.ts
    ...
playwright.config.ts  # projects: chromium, firefox, webkit, mobile-chrome
```

Core helpers worth writing once:

```ts
// Seed state before the app boots
await page.addInitScript((state) => {
  localStorage.setItem('ledgerly-state-v1', JSON.stringify(state));
}, seedState);

// Read persisted state
const state = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ledgerly-state-v1')!));

// Fail any test on uncaught page errors
page.on('pageerror', (e) => errors.push(e));
page.on('console', (m) => m.type() === 'error' && errors.push(new Error(m.text())));
```

Add an `afterEach` that asserts the error list is empty. This alone catches a large share of silent regressions.

---

## Scenario 1: Transfer integrity across its full lifecycle

**Goal:** Prove a transfer is always two linked halves and balances never drift.

**Why it's valuable:** Transfers are the most fragile feature in any ledger. If one half is edited or deleted without the other, net worth silently becomes wrong.

**Steps**
1. Seed Cash = 1,200 and Bank = 3,400. Net worth is 4,600.
2. Create a transfer of 100 from Cash to Bank through `#transaction-form` (type = transfer).
3. Assert state has exactly two transactions with the same `transferGroupId`, sides `source` and `destination`, and the same amount.
4. Assert Cash shows 1,100 and Bank 3,500 on `#/accounts`, and net worth on the dashboard is unchanged at 4,600.
5. Edit the **destination** side to 250. Assert the **source** side is also 250 and balances are 950 and 3,650.
6. Edit the **source** side to change the date and the From account. Assert the destination reflects the date change and balances re-compute.
7. Delete the **source** side. Assert both rows disappear and both balances return to their opening values.
8. Press Undo once. Assert both halves return together (one undo step, not two).
9. Press Redo. Assert both are gone again.

**Edge cases to add**
- Transfer where From equals To (should be rejected).
- Transfer into a Credit Card account (balance direction).
- Delete an **account** that is one side of a transfer. Assert the orphaned half is handled (removed or flagged) and net worth stays consistent.
- Bulk-delete only one half of a transfer (see Scenario 9).

**Assertions that matter:** `sum(all account balances) === net worth` after every step.

---

## Scenario 2: Undo/redo boundary and consistency

**Goal:** Verify the 20-action history limit and that undo/redo restore the exact state, including after reload.

**Why it's valuable:** Undo is a trust feature. Off-by-one limits, a redo stack that survives a new action, or undo that restores only part of an entity are classic bugs.

**Steps**
1. Perform 25 mixed actions: add transaction, edit budget limit, add category, delete account, bulk recategorize, and so on.
2. Click Undo until nothing changes. Count the steps that actually changed state. Expect exactly **20**.
3. Snapshot the full state after each undo and compare it with the snapshot taken before the matching action (build a state-history array while performing actions).
4. Click Redo until nothing changes. Expect exactly 20, and final state deep-equals the post-action-25 state.
5. Undo 3 times, then perform a new action. Assert Redo now does nothing (redo stack invalidated).
6. Undo 2 times, reload the page. Assert current state persisted. Document what happens to history after reload (kept or reset) and pin that behavior with a test.

**Edge cases**
- Undo a delete of a category that budgets and transactions reference. Assert references are restored too.
- Undo/redo while a form is half-filled or in edit mode.
- Rapid-fire 50 Undo clicks (no crash, no negative index).
- The Undo and Redo buttons currently never become disabled, even with nothing to undo. Write the test for the behavior you want (`toBeDisabled` when history is empty) and mark it `test.fail()` until fixed, so the gap is tracked.

---

## Scenario 3: Budget threshold boundaries and recalculation

**Goal:** Confirm progress bars use the right color at exact boundaries and update from every path that changes spending.

**Why it's valuable:** Budget colors are a user-facing promise ("yellow at 80%, red when exceeded"). Boundary bugs (`>` vs `>=`) and floating-point rounding are very common.

**Data-driven table**

| Spent / Limit | Expected class | Expected width |
|---|---|---|
| 79.99 / 100 | none (green) | 79.99% |
| 80.00 / 100 | `warning` | 80% |
| 99.99 / 100 | `warning` | 99.99% |
| 100.00 / 100 | decide and pin it: at the limit, not exceeded | 100% |
| 100.01 / 100 | `danger` | 100% (capped) |
| 0 / 100 | none | 0% |

Use `test.describe.parallel` with a loop over the table, seeding via state.

**Steps per row:** seed a budget and the transaction(s) that produce the spent amount, load `#/budgets`, assert the class and the inline `width`.

**Dynamic scenarios**
- Add an expense and the bar updates without reload.
- **Edit** an expense's category and the old budget drops, the new one rises.
- Delete a transaction and the bar drops back.
- **Bulk re-categorize** 5 transactions and both budgets update.
- Move a transaction's date across a month boundary (Oct 31 to Nov 1) and it leaves the October budget.
- Transfers must **not** count toward a spending budget.
- A budget on a **parent** category versus spending in a **child** (Food versus Food → Groceries). Pin the actual rule.
- Floating point: ten expenses of 0.10 against a 1.00 budget must read exactly 100%, not 99.9999 or 100.0000001.

**Also check:** the computed `background-color` of `.warning` and `.danger` in both light and dark themes meets contrast against the track.

---

## Scenario 4: Recurring engine with a controlled clock

**Goal:** Verify auto-generation for every interval type, month-end handling, catch-up after long gaps, and idempotency.

**Why it's valuable:** Recurring logic runs unattended on app open. Date bugs here create duplicate or missing money and are very hard for users to notice.

**Tooling:** `page.clock.install({ time })` and `page.clock.setFixedTime(...)` to control "today", plus `timezoneId` in the browser context.

**Steps**
1. Daily rule with `nextRunDate` 3 days ago, today fixed at 2026-10-08. Expect 4 entries (Oct 5, 6, 7, 8) and `nextRunDate` of Oct 9.
2. Reload 3 times. Expect still 4 entries.
3. Tamper `nextRunDate` back in localStorage and reload. Expect still 4 (verifies `processedDates` protects against duplicates).
4. Weekly rule that missed 5 weeks: expect 5 or 6 entries on the correct weekdays.
5. **Monthly rule anchored on the 31st:** run through Jan 31, then Feb 28, then Mar 31 (not Mar 28). This exercises `anchorDay`.
6. Monthly on the 29th through a leap year versus a non-leap year.
7. Custom interval of 10 days: assert spacing is exactly 10 days across a month boundary.
8. Large gap: a daily rule with `nextRunDate` one year ago. Assert about 365 entries, the page stays responsive, and no duplicates.
9. A rule dated in the future generates nothing.

**Edge cases**
- Run the same suite under `Asia/Kolkata`, `America/Los_Angeles`, and `Pacific/Kiritimati` (UTC+14) to catch `toISOString()` off-by-one date bugs.
- DST transition days (Europe/London, America/New_York).
- Editing a rule's amount after generation must not rewrite past entries.
- Deleting a rule must not delete the entries it already created.

---

## Scenario 5: Corrupted, missing, and hostile storage matrix

**Goal:** The app boots and stays usable no matter what is in localStorage.

**Why it's valuable:** The requirement says "handle corrupted or missing data gracefully instead of crashing." This is also the real-world failure mode after browser crashes, manual edits, or version upgrades.

**Matrix** (seed with `addInitScript`, then assert on the boot):

| Seeded value | Expected |
|---|---|
| key absent (first visit) | App loads with defaults or demo data |
| `''` (empty string) | Loads, no crash |
| `{not valid json` | Loads, corrupt copy saved to `...-corrupt-backup` |
| `null`, `[]`, `"string"`, `42` | Loads |
| `{accounts:"oops", transactions:[null,5,{id:1}], budgets:null, recurring:7}` | Loads, state sanitized to arrays |
| Transactions referencing a missing account or category | No crash, rows render safely |
| Duplicate IDs | No crash, defined behavior |
| Negative or `NaN` amounts, string amounts (`"12.5"`) | Sanitized or rejected, totals never `NaN` |
| `currency:"ZZZ"`, `theme:42` | Falls back to USD and light |
| `ui.page = 9999`, `ui.pageSize = -5` | Clamped |
| 5 MB payload | Loads in a reasonable time |

**For each row assert:** zero `pageerror` events, the nav renders, every route in `#/...` renders without throwing, and the dashboard never shows `NaN` or `undefined` (`expect(page.locator('body')).not.toContainText(/NaN|undefined/)`).

**Bonus:** stub `localStorage.setItem` to throw `QuotaExceededError` and verify the user is told ("couldn't save") instead of a silent failure. Also run the app with storage disabled entirely.

---

## Scenario 6: CSV import pipeline

**Goal:** Stress the mapping step, parser, and per-row validation.

**Why it's valuable:** CSV import is where real-world messy data enters. Parser bugs mean wrong money, and bad error reporting means unusable imports.

**Upload with:** `page.setInputFiles('#import-csv-input', { name, mimeType: 'text/csv', buffer })`.

**Fixtures to generate**
1. **Happy path:** standard headers (`date,type,account,category,amount,payee`) should auto-map.
2. **Custom headers** (`When, Acct, Kind, Amt, Cat, Who`): nothing auto-maps. The test maps each field in the modal and imports.
3. **Parser torture:**
   - quoted commas (`"Smith, John"`)
   - escaped quotes (`"He said ""hi"""`)
   - newlines inside quoted cells
   - CRLF vs LF line endings
   - UTF-8 BOM at the start of the file
   - trailing blank lines
   - semicolon-delimited file (document the behavior)
   - emoji and non-Latin payees
4. **Validation per row:** a file mixing valid and invalid rows. Assert the error text lists the **right row numbers** (the header counts as row 1, so the second data row is "Row 3"), with specific messages: invalid date, unknown account, amount not above zero, missing category on non-transfer.
5. **Boundary values:** amount `0`, `-5`, `1e3`, `1,234.56`, `$12`, `12,5` (EU decimal). Dates like `2026-02-30`, `31/12/2026`, `12/31/2026`.
6. **All-or-nothing:** the app currently imports **nothing** when any row is invalid. Pin this with a test, and add a `test.fixme` for "import valid rows and report the rest" if that's the desired UX.
7. **Transfers via CSV:** a row with a `toAccount` should create both halves with a shared group ID.
8. **Duplicate import:** import the same file twice. Document whether duplicates are detected.
9. **Scale:** 5,000 rows. Assert it completes within a budget (for example 5 s), the UI stays responsive, and pagination shows the right page count.
10. **Cancel:** closing the modal leaves state untouched and clears stale errors on the next open.

**Security:** a payee of `<img src=x onerror=window.__pwned=1>` must render as text, with `window.__pwned` staying undefined.

---

## Scenario 7: JSON backup round trip and hostile imports

**Goal:** Export then import must be lossless, and bad imports must never destroy good data.

**Why it's valuable:** The backup is the user's only safety net. A lossy round trip is silent data loss.

**Capture the download:** `const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-json-btn')])`.

**Steps**
1. Seed a rich dataset: 3 accounts, nested categories, 200 transactions including transfers, budgets, recurring rules, INR currency, dark theme.
2. Export. Parse the file and assert every top-level key exists.
3. Click "Reset all data" and verify it's empty or default.
4. Import the exported file. **Deep-equal** the persisted state against the original, ignoring only fields you've deliberately decided are volatile.
5. Verify transfers are still linked (`transferGroupId` pairs), and budgets and recurring rules still reference valid IDs.
6. Verify the dashboard numbers match before export and after import.

**Hostile imports (each must show an error toast and leave existing data intact):**
- truncated JSON
- valid JSON with the wrong shape
- an empty file
- a 50 MB file
- a file with `__proto__` / `constructor` keys (prototype pollution check)
- a CSV renamed `.json`
- a backup with transactions pointing to deleted accounts

**Extra:** import into a context that already has data. Document whether it replaces or merges, and assert that behavior.

---

## Scenario 8: Filter, sort, and pagination combinatorics

**Goal:** Prove the transaction list is correct for combined filters, multi-column sort, and paging.

**Why it's valuable:** This view is where users spend most of their time. Each feature is simple alone, and the bugs live in the interactions.

**Seed:** 250 generated transactions with deliberately tricky data: duplicate amounts and dates (to test sort stability), mixed case payees, tags, notes containing regex characters.

**Oracle approach:** compute the expected result in the test with plain TypeScript (`filter`/`sort`/`slice` over the seed), then compare it to the visible rows. This catches subtle errors a hardcoded expectation would miss.

**Cases**
- Each filter alone, then all filters together (date range, account, category, type, min/max amount, text).
- **Inclusive boundaries:** a transaction exactly on `startDate`, `endDate`, `minAmount`, `maxAmount` must be included.
- Min greater than max: no crash, sensible empty state.
- Text search is case-insensitive and matches payee, notes, and tags (pin which fields). Search for `.*`, `(`, `[a-` and `\` must not throw (regex injection).
- Search for `UndoTest1` when payees include `UndoTest1` and `UndoTest10`-`UndoTest19`: expect 11 matches.
- **Multi-sort:** click Type, then Amount, then Payee (shift-click as the app expects). Assert the stack in `ui.sort` is capped at 3 and the visible order matches the oracle. Toggle asc/desc.
- Sort stability for equal keys.
- **Pagination:** page size 10, 25, 50. Last page has the remainder. Changing a filter resets to page 1. Deleting the only row on the last page moves to the previous page rather than showing an empty page. Page number beyond range in saved state gets clamped.
- Empty result shows "No transactions match the current filters." and a Reset restores everything.
- Filters, sort, and page survive a reload (they're saved in `ui`). Assert that.
- **Performance:** 10,000 transactions. Filtering plus sorting should finish within a set budget, and the DOM should hold only one page of rows.

---

## Scenario 9: Bulk selection, bulk delete, and bulk re-categorize

**Goal:** Selection state stays correct across re-renders, pages, and filters, and bulk actions are safe.

**Why it's valuable:** Bulk actions are destructive and the selection UI re-renders constantly. This is where "I deleted the wrong rows" bugs happen.

**Important Playwright note:** the table re-renders after each click, so re-query locators after each checkbox click (stale handles caused false results while exploring this app). Use `page.getByRole('row')` and `.nth()` freshly each time.

**Steps**
1. Select 3 rows individually. Assert `ui.selectedTransactionIds` has exactly those 3 IDs.
2. Bulk re-categorize to Housing. Assert exactly those 3 changed, selection clears, and budgets and the dashboard update.
3. Use **Select all**. Pin the scope: current page only or all filtered results. The app selected only the visible page of rows when tested, so assert that and verify "Delete selected" removes exactly those.
4. Select rows on page 1, go to page 2, come back. Is the selection kept? Pin it.
5. Select rows, then change a filter so some selected rows are hidden. Bulk delete must not delete hidden rows unless that's explicitly intended.
6. **Transfers:** select only one half of a transfer and bulk delete. Assert the other half is removed too (Scenario 1 invariant). Bulk re-categorize on a transfer should not give it a category.
7. Bulk action with zero selection: no-op with a message, no crash.
8. Undo after bulk delete restores all rows in **one** step.
9. Delete has no confirmation dialog today. Add a test that records this, and a `test.fixme` for "destructive bulk delete asks for confirmation" if you want that policy.

---

## Scenario 10: Hash routing, deep links, and history

**Goal:** Every route works from a cold load and the browser's history behaves.

**Why it's valuable:** The spec requires back-button support between views. Routing bugs show up as blank pages, trapped back buttons, or lost state.

**Steps**
1. Cold-load each of the 7 routes directly (`page.goto('/#/budgets')`). The right section is visible and every other section is hidden.
2. Click through Transactions, Budgets, Categories, then `page.goBack()` twice. Assert the hash and visible section after each, then `page.goForward()`.
3. Navigate to an unknown hash (`#/nope`, `#`, `#/transactions/extra`, `#//`). Assert a sane fallback (dashboard) and no `pageerror`.
4. Rapidly change the hash 30 times. The final view matches the final hash, with no half-rendered mix.
5. Reload on every route and stay on that route.
6. History length: visiting the same route twice shouldn't add duplicate entries that trap the back button.
7. The active nav item gets the active style and `aria-current` where intended.
8. Opening a modal (CSV mapping), then pressing Back: define the behavior (modal closes vs. leaves the page) and pin it.
9. State survives route change: filters set on Transactions are still there after visiting Budgets and returning.

**Accessibility add-on:** after a route change, where does keyboard focus go? Assert it moves to the new view's heading or content instead of staying on the nav link, or record it as a gap.

---

## Scenario 11: Keyboard-only journey plus automated accessibility audit

**Goal:** A user can complete the full lifecycle with the keyboard alone, and axe finds no serious violations.

**Why it's valuable:** "Keyboard-accessible, all actions reachable without a mouse" is an explicit requirement, and it's easy to regress. Automated checks run on every PR for free.

**Keyboard journey** (use only `page.keyboard.press`, never `.click()`):
1. Tab to Accounts, press Enter, fill the account form with Tab and typing, Enter to submit.
2. Add a transaction of each type, filter the list, sort via the sort buttons, select a row with Space, bulk re-categorize.
3. Open the CSV import (Enter on the button) and map columns with arrow keys on the selects.
4. Press **Escape** in the CSV modal. Assert it closes and focus returns to the button that opened it.
5. Assert **focus trap**: Tab inside the modal never reaches the page behind it.
6. Toggle the theme and trigger Undo and Redo from the keyboard.

**Automated audit**
```ts
import AxeBuilder from '@axe-core/playwright';
const results = await new AxeBuilder({ page })
  .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
expect(results.violations).toEqual([]);
```
Run it on every route, in light and dark themes, with the CSV modal open, and with a validation error visible.

**Known candidates to expect from the audit (found while exploring):**
- Sort headers are real buttons but `th` has no `aria-sort`, so screen readers don't hear the current sort.
- The two hidden file inputs (`#import-json-input`, `#import-csv-input`) have no label.
- There's no skip-to-content link.
- Row action buttons say only "Edit" and "Delete". Check that each has an accessible name that identifies the row.
- Toasts use `aria-live="polite"`, which is good. Assert that a save, an error, and an import result each get announced.
- Chart canvases have a text alternative via `aria-label`. Assert it updates when data changes.

Also check visible focus (`:focus-visible` outline) on every interactive element with a screenshot per control type.

---

## Scenario 12: Theme, currency, and responsive visual regression

**Goal:** Catch layout and rendering regressions across theme × currency × viewport.

**Why it's valuable:** The UI has 3 dimensions of variation, and manual testing covers a fraction. Screenshot diffs make UI regressions visible in PRs.

**Matrix:** theme (light, dark) × currency (USD, INR) × viewport (375×812, 768×1024, 1440×900) × route (7). Use `expect(page).toHaveScreenshot()` with masked dynamic regions (dates, generated IDs) and fixed seed data plus `page.clock` so output is deterministic.

**Behavioral checks**
- **Initial theme** follows `prefers-color-scheme` on first visit (`colorScheme: 'dark'` in context) and respects the saved choice afterward.
- Theme choice persists across reload.
- Switching currency changes the display symbol and grouping everywhere (dashboard cards, account list, table, budgets, chart legends) and **does not modify stored amounts**. Compare the persisted state before and after.
- Format correctness: `₹1,23,456.00` vs `$123,456.00` grouping rules, negative amounts, zero.
- At 375px: `document.documentElement.scrollWidth <= window.innerWidth` on every route, the nav wraps usably, tables scroll inside their container, and tap targets are at least about 44px.
- Charts resize on viewport change (`page.setViewportSize`) and redraw correctly.
- Long account and category names, long payees, and 8-digit amounts don't break the layout.
- Print and zoomed views (200%) don't hide controls.

---

## Scenario 13: Dashboard correctness against an independent oracle

**Goal:** Every dashboard number must match what you'd compute from the raw state.

**Why it's valuable:** The dashboard is the headline of the product. A subtle aggregation bug (counting transfers as income, wrong month, wrong sign) misleads every user and is invisible to simple UI tests.

**Approach:** write a small, independent `computeExpected(state)` in the test and compare against the UI after seeding and after each mutation. Don't reuse app code.

**Assert**
- **Net worth** = sum of opening balances + all income - all expenses, with transfers net zero. Credit-card balances reduce net worth.
- **Monthly income and expenses** are for the **current month only**.
- **Transfers are excluded** from income and expense totals, and from spending by category.
- **Top category** shows the right child path (`Food → Groceries`) and amount.
- **Pie chart:** the `aria-label` and legend list the same categories and amounts as the oracle. Sum of slices equals total monthly spending. A category with 0 spending is absent.
- **12-month trend:** exactly 12 labeled months ending at the current month. Each month's income and expense match the oracle. Months with no data show 0, not a gap.
- **Boundaries:** a transaction on the last day of a month at 23:59 and the first day of the next. Run under multiple time zones (Scenario 4 technique).
- **Live updates:** add, edit, delete, undo, bulk re-categorize, and import all refresh the cards and charts without a reload.
- **Empty state:** zero accounts or zero transactions shows zeros and a sensible chart, no `NaN`, no exception from Chart.js.
- **Large values:** 1e9 amounts don't overflow card layout.
- **Currency toggle** re-labels all cards and legends.

---

## Scenario 14: Multi-tab concurrency and storage failures

**Goal:** Two tabs on the same data shouldn't silently destroy each other's changes.

**Why it's valuable:** Many users keep a finance app open in multiple tabs. With localStorage and in-memory state, "last write wins" can overwrite real data.

**Setup:** one `BrowserContext`, two `Page`s (shared localStorage).

**Scenarios**
1. **Stale write:** Tab A adds transaction X. Tab B (loaded before X) adds transaction Y. Reload Tab A. Do both X and Y exist? If Y overwrote X, that's a lost update. Record the result either way.
2. **Does Tab B react** to the `storage` event from Tab A, or show stale data until reload?
3. **Recurring race:** set a due recurring rule, then open the app in two tabs at nearly the same time. Assert generated entries are not duplicated.
4. **Undo across tabs:** undo in Tab A after Tab B changed data. It must not resurrect deleted data or crash.
5. **Quota exceeded:** override `Storage.prototype.setItem` to throw `QuotaExceededError`. Assert the user sees an error and the in-memory UI doesn't pretend the save succeeded.
6. **Storage unavailable** (throwing getter on `window.localStorage`, as in some privacy modes): app still boots and says data won't persist.
7. **Offline:** `context.setOffline(true)` after load. The app is local-only, so everything should still work. Reload while offline works only if cached, so document the expectation.
8. **Hard kill mid-write:** stub `setItem` to throw on the 2nd call during a multi-step action (a transfer creates two records). Assert state isn't left with half a transfer after reload.

---

## Scenario 15: Input validation, numeric precision, and injection hardening

**Goal:** No input can corrupt money math or execute script.

**Why it's valuable:** Everything the user types ends up in stored state and in generated HTML. The app builds markup with template strings, so output escaping is the highest-value security check, and floating-point drift is the highest-value correctness check.

**Numeric precision**
- Amounts: `0`, `-1`, `0.001`, `0.005` (rounding), `1e21`, `99999999999`, `12.345`, `.5`, `5.`, `1,000`, `abc`, empty, whitespace. Define expected accept/reject and pin each.
- 10 × 0.10 and 3 × 0.1 + 0.2 stored and summed. Balances, budget percentages and chart totals show no `0.30000000000000004` artifacts.
- Opening balance negative and very large.
- Budget limit `0` (division by zero in the percentage) must not show `Infinity%` or `NaN%`.

**Dates**
- `2026-02-30`, `0000-01-01`, `9999-12-31`, empty, a future date, and manual typing into the date input.

**Business rules**
- Transfer to the same account. Transfer without a destination.
- Expense or income without a category ("Category is required for non-transfer entries.").
- Duplicate account, category and budget (same category and month) names.
- Delete a category used by transactions, budgets, and recurring rules. Assert the dependents are handled and none are left pointing at a missing ID.
- Delete a parent category that has children.
- Editing a transaction's type from expense to transfer and back.
- Tags: empty, duplicates, commas, 500 characters, leading and trailing spaces.

**Injection and rendering** (use a payload list across **every** free-text field: account name, category name, payee, notes, tags, budget and recurring titles, CSV cells, JSON import, localStorage seed)
- `<img src=x onerror="window.__xss=1">`
- `"><script>window.__xss=1</script>`
- `'; DROP TABLE--`
- `${7*7}` and `{{7*7}}` (template injection in string templates)
- A 10,000-character string, RTL text, emoji, zero-width characters
- Assert `await page.evaluate(() => window.__xss)` is `undefined`, the text appears **literally** in the UI, and attribute contexts (`data-id`, `aria-label`, `value`) can't be broken out of with `"`.

**Double submit:** press Enter twice quickly on Save and click Save twice. Exactly one record is created.

---

## Suggested rollout order

| Phase | Scenarios | Reason |
|---|---|---|
| 1. Protect the money | 1, 3, 13, 15 | Highest business risk, catches wrong numbers |
| 2. Protect the data | 5, 7, 14, 2 | Data loss and recovery |
| 3. Protect the flows | 4, 6, 8, 9, 10 | Complex logic and large surface |
| 4. Protect the experience | 11, 12 | Accessibility and visual regression in CI |

## Known gaps found during exploration (turn into tracked tests)

| Observation | Suggested test status |
|---|---|
| Undo/Redo buttons are never disabled when history is empty | `test.fail()` until fixed |
| CSV import rejects the whole file if any row is invalid | Pin current behavior, add `test.fixme` for partial import |
| Bulk delete and single delete have no confirmation | Pin, then `test.fixme` if confirmation is desired |
| `aria-sort` missing on sortable headers | Fails axe or custom check |
| Hidden file inputs unlabeled | Fails axe |
| No skip-to-content link | Custom check |
| Select all covers only the visible page | Pin and document |
