# Verification results

Verified on 8 October 2026 against the bundled reference scenarios. Application runtime: vanilla HTML, CSS and ES modules; native canvas charts; localStorage persistence.

## Executed checks

| Suite | Result |
|---|---|
| Core and DOM integration | 9 passed, 0 failed |
| Chromium desktop | 131 passed, 0 failed |
| Mobile Chrome emulation | 131 passed, 0 failed |
| Firefox desktop | 131 passed, 0 failed |
| WebKit desktop | 131 passed, 0 failed |
| Explicit visual comparisons | 168 baseline images across Chromium desktop/mobile |

Browser functional total: **524 passed**, with no skipped tests or retries. Each test checks page errors and console errors. Axe checks cover all seven routes in both themes, plus the CSV dialog and validation errors. The visual matrix covers two themes, two currencies, three widths and seven views. Category geometry explicitly checks that child cards sit below their parents.

Raw JSON browser reports and the unit-test log are included in `docs/verification/`. Reports contain temporary runner paths for screenshots/traces; those temporary artifacts are not included. Screenshot baselines are included under `tests/e2e/04-experience.spec.ts-snapshots/`.

## Reproduce

Use Node 24 and Python 3. From the project root:

```sh
npm ci
npm test
npx playwright install --with-deps
npm run test:e2e
```

`npm run test:e2e:visual` enables Chromium/mobile baseline comparisons. Bundled baseline images use Linux Chromium 153; the locked Playwright version may install a different browser build. Review and regenerate images for your own environment with `npm run test:e2e:update`. Functional tests capture screenshots without enforcing platform-specific baseline equality. On Windows, set `LEDGERLY_VISUAL=1` in your shell and run the equivalent Playwright command; the npm visual scripts use POSIX environment syntax.

## Scope and limits

These are automated browser checks, including a mobile emulator; no physical-device or human screen-reader certification is claimed. Print layout, extreme zoom and assistive technologies should receive human review. WebKit testing does not constitute testing every Safari device/version. Offline actions work in an already loaded page; offline cold loading depends on browser/hosting caching. There is no service worker.

Web Locks protect supported browsers against simultaneous tab writes. Without Web Locks, reconciliation reduces stale writes but cannot guarantee atomicity across processes. History is session-only and clears on a peer-tab update. Currency changes label units and do not convert values. CSV import is all-or-nothing and intentionally permits repeated-file duplicates. The import size cap is 10 MB. These choices and the complete scenario mapping are documented in `behavior-and-coverage.md`.
