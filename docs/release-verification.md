# Phase 5 release verification

Verified locally on 23 October 2026, Europe/Riga. Application revision: `e500ddc`. This report records executed checks, rather than a hosted deployment or an accessibility certification.

## Scope and preservation

The work improves navigation, readability, chart interpretation, validation feedback, mobile layout and release preparation. It preserves the existing calculator scope, Python backend, SQL migrations and native Windows workflow.

Before changes, a Git bundle, PostgreSQL dump and data fingerprints were saved under the ignored `.local/recovery/` directory. The original Git history remains intact. No remote push, account connection, public deployment or repository visibility change was performed. The repository was private according to the owner's configuration; visibility was not changed or independently queried through GitHub.

All **1,155 observations across eleven indicators** remain unchanged. Full database observation records and migration records were compared with the baseline. The eight official response snapshots, three static exports and three migration files also remain byte-for-byte unchanged from the initial commit. No ingestion refresh was performed during Phase 5.

Changed files, grouped by purpose:

| Files | Purpose |
| --- | --- |
| `frontend/src/App.tsx`, `CountrySelector.tsx`, `AnalyticsPage.tsx`, `CalculatorsPage.tsx`, `styles.css` | Navigation, mobile layout, statistical context, contrast and form semantics |
| `frontend/src/ComparisonChart.tsx`, `AnalyticsChart.tsx`, `CalculatorChart.tsx` | Shape/pattern differentiation, legends and keyboard hints |
| `frontend/src/App.test.tsx`, `AnalyticsPage.test.tsx`, `CalculatorsPage.test.tsx` | Navigation, snapshot, error and accessible-name regressions |
| `.gitattributes`, `frontend/.node-version`, `frontend/package.json`, `frontend/public/_headers`, `frontend/scripts/verify-static.mjs` | Reproducible builds, Node pin, static verification and Pages policies |
| `README.md`, `docs/deployment.md`, `docs/portfolio.md`, `docs/release-verification.md`, six PNGs in `docs/screenshots/` | Setup, release evidence and genuine portfolio material |

## Tests and browser checks

Environment: Windows 11, Python 3.13, native PostgreSQL 18 on port 5433, Node.js 24.16.0, npm 11.16.0 and local Microsoft Edge through Playwright.

| Check | Executed result |
| --- | --- |
| Python suite, including PostgreSQL integration | **311 passed** using the isolated `compass_test` database |
| Frontend suite | **151 passed**, up from the 146-test baseline |
| Python dependency consistency | `pip check` passed |
| Frontend clean installation | `npm ci` passed; npm reported zero known vulnerabilities at installation time |
| API-configured and static production builds | Both passed |
| Static artifact validator | Passed for the final build |
| Fresh tracked-file checkout | Clean install, static build and validation passed without ignored environment files, Python or a database connection |
| Build reproducibility | All fourteen output files matched the working-tree build byte-for-byte |
| Static validator negative cases | Eight deliberately invalid artifacts were rejected: unexpected private/settings/certificate files, localhost code, future retrieval dates, empty scenarios, duplicate observations and unofficial sources |
| Statistical UI regression | All eleven indicators and fourteen analyses exercised in both static and API modes, including CSV scope, common-period rankings and the earnings break |
| Calculator UI regression | Static and API modes passed, including zero rates, full cash funding, missing income, invalid inputs, reverse budgets, scenarios and final balance reconciliation |
| API calculation verification | Matching results passed; deliberate mismatches and unavailable-server responses produced explicit feedback |
| Fresh static browser session | Charts, lazy modules, data files and CSV downloads worked below `/portfolio/`; all nine page/section hash destinations reloaded correctly |

The full suites can be rerun from the repository root:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://compass:compass@localhost:5433/compass_test'
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
cd frontend
npm.cmd ci
npm.cmd test -- --run
npm.cmd run build
npm.cmd run build:static
npm.cmd run verify:static
```

The database URL above uses the documented project development defaults. Use the actual test database credentials if customized. Never point integration tests at a database containing important data. Browser audit tools and temporary artifacts stayed under ignored `.local/` paths; they are not runtime dependencies.

An existing service occupied port 8000 and was left untouched. API browser checks used a temporary FastAPI process on port 8001. Static checks blocked API access and recorded no backend requests, with no dependence on that existing service. A complete fresh static build was also served independently. This demonstrates operation without backend access; the unrelated port-8000 process was not physically stopped.

## Statistical and financial review

Every exported observation was matched to its official snapshot, including value, status and selected dimensions. The CSV matched the JSON. All fourteen analyses and 79 base-period scenarios reproduced from the stored observations. A separate Decimal reference calculation checked 5,490 derived points and 4,482 explicit unavailable results. Missing periods remain unavailable, and cumulative earnings comparisons stop before the 2024 compiler break.

A separate high-precision Decimal program checked 300 generated fixed-rate cases covering 104,019 monthly schedule rows, plus 150 inverse-budget checks. The existing Python/TypeScript regression suite checks schedule agreement, cent rounding, zero rates and the cleared final balance. These are automated mathematical checks, not a claim of a manual financial audit or a bank-approved lending model.

Official values and hypothetical inputs remain separate. ECB borrowing costs are dated national statistics, not mortgage offers. No user financial assumptions were found in local/session storage, URLs or the statistical exports. Calculators retain values only in application memory while navigating.

## Accessibility and responsive review

Real anchor navigation, skip links and heading focus support keyboard use and browser history. All four navigation links remain visible on mobile. Country markers use distinct shapes, and principal/interest charts use pattern differences with table alternatives. Form hints and errors are associated with their controls. Labelled result and legend containers have explicit group semantics.

The final axe-core 4.14.0 run covered **66 page states** at desktop and mobile widths, with **zero reported violations**. It covered every raw indicator and analysis, methodology, tables, calculator errors and chart views. Axe still marked color contrast for manual review in repeated chart/offscreen content: 2,806 node occurrences across those states. Those are incomplete automated assessments, not 2,806 confirmed failures. Visual review, stronger text/control contrast and chart shapes/patterns address the practical presentation, but this is not proof that every rendering satisfies WCAG 2.2 AA.

Thirty-four scripted keyboard/navigation checks passed: skip link, heading/section focus, direct reloads, browser back/forward, retained calculator inputs, country selection, native selects, chart keyboard interaction and table alternatives. The four main pages had no horizontal page overflow at **320, 390, 640, 768 and 1440 CSS pixels**. Navigation targets were at least 44 by 44 pixels. A 640-pixel viewport was used as a reflow proxy for 200% zoom at 1280 pixels; browser zoom itself was not changed. Data tables may scroll within their own containers.

No full NVDA, JAWS or VoiceOver session, physical mobile-device test or accessibility certification was performed. Those remain worthwhile checks before claiming broader accessibility support.

## Static release and performance

The production artifact contains only `index.html`, the Pages `_headers` file, compiled assets and the three reviewed data exports. The validator checks required data, provenance, duplicate observations, public file layout, private-path/token patterns, localhost references and upload size limits. Eight injected failure cases confirmed that the checks reject those regressions. No exposed credentials or private files were found in the reviewed release.

Cloudflare security/cache policies were exercised using a local HTTP server that applied the prepared `_headers` rules and gzip compression. Actual charts, lazy imports and blob CSV downloads worked under that policy, with no unexpected console or page errors. This is a local simulation; Cloudflare's own response headers and deployment behavior must be checked after publication.

| Final artifact measurement | Bytes |
| --- | ---: |
| Fourteen files, total uncompressed | 4,638,058 |
| Entry JavaScript | 257,961 |
| JavaScript needed for the initial rendered house-price chart, including shared chart modules | 619,221 |
| Same initial JavaScript with local gzip | 184,910 |
| All emitted JavaScript with Node gzip | 215,294 |
| CSS | 36,778 |
| Observation JSON, raw / gzip | 710,244 / 18,068 |
| Analytics JSON, raw / gzip | 2,701,210 / 270,876 |
| Observation CSV, raw / gzip | 469,003 / 10,662 |

Tailwind now scans only `frontend/src`. This fixed a real fresh-checkout discrepancy and reduced that checkout's CSS from 76,286 to 36,778 bytes. Data assets were preserved. Analytics JSON and calculator/chart modules load when needed. The initial chart still needs a substantial shared chart module; no claim of a smaller initial JavaScript payload, Lighthouse score or real-world mobile speed is made. Measurements came from a local browser/server, not a slow-network or physical-device benchmark. No production dependency was added.

## Portfolio assets and remaining actions

Six genuine Edge captures are in [the screenshot gallery](portfolio.md#genuine-screenshot-gallery): dashboard, country comparison, housing versus earnings, mortgage, scenarios/repayment and mobile. They were captured from the fresh production build after chart rendering completed. Calculator images use labelled hypothetical defaults: EUR 150,000 purchase price, 20% down, 4% constant nominal rate, 25 years and no entered income. No design mockups or generated images are presented as screenshots.

The [deployment guide](deployment.md) provides exact Cloudflare Pages Free Direct Upload commands, an optional private Git integration configuration and instructions for linking the eventual URL from GitHub and the personal portfolio. No live URL exists as part of this preparation. Account authorization, public upload, remote push and any source-visibility decision remain manual actions requiring the owner's approval.

The Python suite reports one upstream Starlette TestClient deprecation warning. It does not fail tests. Provider-specific behavior, full assistive-technology testing and physical-device performance remain unverified. The statistical release is a dated snapshot, not a live feed. Future source updates and public releases require a reviewed refresh and rebuild.
