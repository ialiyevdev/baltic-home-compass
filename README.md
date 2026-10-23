https://baltic-home-compass.pages.dev/

# Baltic Home Compass

A portfolio project comparing housing and household economic indicators in Estonia, Latvia and Lithuania. It brings official statistics and personal mortgage scenarios into one interface, while keeping their definitions separate. A house-price index describes price changes; it does not estimate the asking price of a home.

The challenge is comparison: earnings, property indices, consumer prices and borrowing rates use different units, dates and methods. Baltic Home Compass makes those differences visible instead of turning them into a single affordability score.

## What it does

- **Compare Countries:** eleven Eurostat and ECB indicators, country/date filters, charts, accessible tables and CSV exports.
- **Analytics:** fourteen selections covering common-period changes, housing versus earnings, HICP-adjusted trends and country rankings.
- **Calculators:** mortgage payments, household ratios, reverse purchase budgets, rate scenarios and reconciled amortization schedules. Defaults are hypothetical examples.
- **Data & Methodology:** official definitions, units, source flags, completeness, observation dates and retrieval history.

The committed data contains **1,155 observations**. The public build reads a dated statistical snapshot and calculates financial scenarios in the browser. The full FastAPI/PostgreSQL implementation remains available for local ingestion and API development. No public deployment has been made as part of this release preparation.

[Deployment guide](docs/deployment.md) · [Portfolio descriptions and screenshots](docs/portfolio.md) · [Release verification](docs/release-verification.md) · [Calculation specification](docs/calculations.md)

## Try the static application

Install Node.js **24.16.0** (the version pinned in `frontend/.node-version`), then run:

```powershell
cd frontend
npm.cmd ci
npm.cmd run build:static
npm.cmd run verify:static
npm.cmd run preview
```

Open <http://127.0.0.1:4173>. This workflow uses committed exports and needs no Python, PostgreSQL, environment file or Docker. Use the HTTP preview server; opening `dist/index.html` directly cannot load JSON with browser fetch. Hash links such as `/#analytics` and `/#calculators/amortization` can be copied and reopened without a server-side router.

## Architecture and technology choices

```mermaid
flowchart LR
    E[Eurostat JSON-stat and ECB CSV] --> P[Python retrieval and validation]
    P --> S[Attributed raw snapshots]
    P --> DB[(PostgreSQL)]
    DB --> A[FastAPI and Python analytics]
    DB --> X[Deterministic JSON and CSV export]
    A --> R[React interface in API mode]
    X --> D[React static demo]
    F[Versioned financial specification] --> T[TypeScript browser calculations]
    F --> M[Stateless Python calculations]
    T --> D
    M --> A
```

| Technology | Role and reason |
| --- | --- |
| React, TypeScript and Vite | Interactive filters and forms, typed data contracts, and a standalone production build |
| Tailwind CSS and Recharts | Consistent responsive styling and charts, supported by text summaries and tables |
| Python, httpx and pandas | Official API retrieval, explicit validation, transformation and repeatable exports |
| FastAPI, Pydantic and psycopg | Typed HTTP endpoints and direct PostgreSQL queries without a large service framework |
| PostgreSQL 18 and SQL migrations | Constraints, idempotent observations, ingestion history and reusable analytical views |
| pytest, Vitest and Testing Library | Pipeline, API, calculation and user-interface regression checks |

The deployment boundary is intentional: a public demonstration can serve verified exports without a continuously running database, while the local application demonstrates the complete data lifecycle.

## Local setup (PowerShell)

Install Python 3.12+, Node.js 24.15+ and the native [PostgreSQL 18 Windows binaries](https://www.postgresql.org/download/windows/), including the server and command-line tools. This workflow requires neither Docker nor WSL. Development was verified with Python 3.13 and Node 24.16. Run commands from the repository root unless a command changes directory.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install -e '.[dev]'
.\scripts\local-postgres.ps1 setup
.\.venv\Scripts\python.exe -m database.migrate
.\.venv\Scripts\python.exe -m pipelines.sync
.\.venv\Scripts\python.exe -m pipelines.export_static
```

The helper uses `C:\Program Files\PostgreSQL\18\bin` by default. For another installation, pass `-PostgresBin 'D:\PostgreSQL\18\bin'`. If PowerShell blocks script execution, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local-postgres.ps1 setup`; this applies to that process only.

The project cluster stores persistent data in `.local/pgdata`, listens on loopback at `localhost:5433` and uses database/user/password `compass` by default. These are local development credentials; change `DATABASE_URL` before initializing a new cluster if needed. `setup` reuses an existing cluster and creates `compass` and `compass_test` only when absent. It does not reset passwords, drop databases or erase existing data. Existing PostgreSQL services, including a service on port 5432, are left alone.

The server is started with native `pg_ctl`; it is not registered as an automatic Windows service. Its data survives terminal closure and reboot. After restarting Windows, start it again:

```powershell
.\scripts\local-postgres.ps1 start
.\scripts\local-postgres.ps1 status
```

Stop this project cluster with `.\scripts\local-postgres.ps1 stop`. If a different process occupies port 5433, the helper reports the conflict rather than stopping it. To use a different project port, update the port in `DATABASE_URL`; the helper reads that configuration. To use an independently managed Windows PostgreSQL service, create a dedicated database and role there, set `DATABASE_URL`, and skip the helper entirely.

Migrations are transactional, ordered, checksummed and safe to rerun. Add a new migration instead of changing an applied one.

Start the API in one terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another:

```powershell
cd frontend
npm.cmd ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm.cmd run dev
```

Open <http://127.0.0.1:5173>. API documentation is at <http://127.0.0.1:8000/docs>. `npm.cmd` avoids the PowerShell script execution-policy problem with `npm.ps1`; virtual-environment activation is unnecessary with the explicit Python path.

The copied `frontend/.env.local` sets `VITE_API_BASE_URL=http://127.0.0.1:8000`, so the local browser retrieves the database-backed `/api/export` through FastAPI. Restart Vite after changing this variable. An API failure is shown explicitly; the client does not silently switch to older static data. For the independent static demo, omit or comment out `VITE_API_BASE_URL` and restart Vite. It then reads the committed `frontend/public/data/observations.json`, without needing PostgreSQL or FastAPI.

## Data and reproduction

All series cover EE, LV and LT. Defaults begin in 2020. The API response, rather than a hardcoded date, determines the latest observation.

| Indicator | Official dataset | Selected dimensions | Meaning |
| --- | --- | --- | --- |
| House price index | [`prc_hpi_q`](https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table?lang=en) | `freq=Q`, `purchase=TOTAL`, `unit=I15_Q` | Quarterly residential property price index, 2015=100 |
| Annual net earnings | [`earn_nt_net`](https://ec.europa.eu/eurostat/databrowser/view/earn_nt_net/default/table?lang=en) | `freq=A`, `currency=EUR`, `estruct=NET`, `ecase=P1_NCH_AW100` | Annual net EUR for a single person without children at 100% of average gross earnings |
| Consumer price index | [`prc_hicp_minr`](https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en) | `freq=M`, `coicop18=TOTAL`, `unit=I25` | Monthly all-items HICP index, 2025=100 |
| Annual inflation | `prc_hicp_minr` | `freq=M`, `coicop18=TOTAL`, `unit=RCH_A` | Percentage change from the same month of the previous year |
| Median equivalised disposable income | [`ilc_di03`](https://ec.europa.eu/eurostat/databrowser/view/ilc_di03/default/table?lang=en) | `freq=A`, `age=TOTAL`, `sex=T`, `statinfo=MED_EI`, `unit=EUR` | Person-based annual income adjusted for household size and composition |
| Household consumption expenditure | [`nama_10_cp18`](https://ec.europa.eu/eurostat/databrowser/view/nama_10_cp18/default/table?lang=en) | `freq=A`, `coicop18=TOTAL`, `unit=CP_MEUR` | Domestic aggregate consumption at current prices, million EUR |
| Household consumption volume | `nama_10_cp18` | `freq=A`, `coicop18=TOTAL`, `unit=CLV_I20` | Official chain-linked volume index, 2020=100 |
| Housing-cost overburden | [`ilc_lvho07a`](https://ec.europa.eu/eurostat/databrowser/view/ilc_lvho07a/default/table?lang=en) | `freq=A`, `unit=PC`, `rskpovth=TOTAL`, `age=TOTAL`, `sex=T` | Population share whose household housing costs exceed 40% of disposable income, net of housing allowances |
| Household consumption price level | [`prc_ppp_ind_1`](https://ec.europa.eu/eurostat/databrowser/view/prc_ppp_ind_1/default/table?lang=en) | `freq=A`, `indic_ppp=PLI_EU27_2020`, `ppp_cat18=E011` | Household consumption price level relative to the EU-27 average in each year |
| Actual rent price index | `prc_hicp_minr` | `freq=M`, `coicop18=CP041`, `unit=I25` | Index of actual rental payments for housing, 2025=100 |
| House-purchase borrowing cost | [ECB `MIR`](https://data.ecb.europa.eu/data/datasets/MIR) | `M.<country>.B.A2C.AM.R.A.2250.EUR.N`, unit `PCPA`, multiplier 0 | Monthly national new-business borrowing-cost benchmark, percent per annum |

Net earnings are a modelled tax-and-benefit case, not a median wage, a typical salary or an actual household income. Eurostat marks a break in 2024 for all three selected countries: compilation changed from OECD to JRC/EUROMOD. Do not infer earnings growth across this break. See the [earnings methodology, section 19](https://ec.europa.eu/eurostat/cache/metadata/en/earn_net_esms.htm).

The current HICP table uses ECOICOP version 2 and a 2025 reference base. Its index and inflation rate are separate published measures; neither is an amount in euros or a personal cost-of-living budget. Negative annual inflation is valid. See [Eurostat's HICP information](https://ec.europa.eu/eurostat/web/hicp/information-data).

EU-SILC income periods label the survey year. For the selected countries, income refers to the previous calendar year: survey 2025 describes income in 2024. Equivalised income is assigned to people using household composition; it is not an actual household's take-home income. It is displayed without an HICP deflation that would incorrectly assume the survey label is the income year.

Consumption expenditure is a domestic-territory aggregate: spending by resident and non-resident households within the country, excluding residents' spending abroad. It is neither per-capita spending nor an example household budget. The separate official volume index uses national-accounts price adjustments; the application does not substitute HICP for its deflator. See the [consumption methodology](https://ec.europa.eu/eurostat/cache/metadata/en/nama_10_cp18_esms.htm).

The suggested urbanisation table `ilc_lvho07d` did not provide the selected total-population series for Latvia. The verified all-population table `ilc_lvho07a` is used instead. Overburden is a share of people in private households, not the average percentage of income spent on housing. Price-level index code `EU27_2020` identifies EU membership composition; it does not make 2020 the time base. Rent indices describe existing actual rental payments, not asking rents or amounts in EUR.

ECB MIR covers euro-denominated new house-purchase business for households and non-profit institutions serving households. The selected harmonised national benchmark uses annualised agreed rates / narrowly defined effective rates and moving-average volume weights. It is not necessarily APRC or a personal bank offer. All three country keys, the unscaled `PCPA` unit and observation-status codes are checked against the [official ECB API](https://data-api.ecb.europa.eu/service/data/MIR/M.EE+LV+LT.B.A2C.AM.R.A.2250.EUR.N?startPeriod=2020-01&format=csvdata) and its codelists.

The adapters verify selected codes against publisher metadata, decode Eurostat JSON-stat positions in dimension order and validate ECB CSV keys and units. They retain nulls and source flags, reject duplicates and invalid periods, and apply measure-specific value checks. Requests have timeouts, bounded retries and a 24-hour cache. Dataset codes, start periods, units and API settings are configured in `.env`.

```powershell
# Bypass the 24-hour cache and fetch the official API again.
.\.venv\Scripts\python.exe -m pipelines.sync --refresh

# Update one selected indicator.
.\.venv\Scripts\python.exe -m pipelines.sync --indicator annual_net_earnings --refresh

# Explicitly restore the committed real response when offline.
.\.venv\Scripts\python.exe -m pipelines.sync --from-snapshot

# Read a consistent database snapshot and regenerate JSON and CSV.
.\.venv\Scripts\python.exe -m pipelines.export_static
```

`data/snapshots/` holds official responses, request URLs and actual retrieval timestamps. Three HICP indicators share a response; the ECB snapshot retains its original CSV, publisher update header and codelist references. PostgreSQL preserves selected dimensions, original numeric values, unit metadata, publication timestamps, URLs, flags and ingestion runs. Upserts use `(country, indicator, period)` and skip unchanged measurements, preserving their original row provenance. Revisions update only affected rows. A configuration change that would mix a stored indicator's source or dimensions is refused; existing observations are retained.

Each indicator records its last successful sync and latest attempt. A failed refresh keeps its previous observations, allows independent sources to finish, and produces a nonzero exit status. Offline import preserves the original retrieval timestamp. Static exports retain per-indicator status, units, definitions and provenance. Repeated export of the same database state produces identical bytes; `exported_at` uses the last successful ingestion timestamp for this reason.

On Windows, a running Vite server can hold the JSON file open. Stop Vite before regenerating a changed export if Windows reports an access-denied error, then restart it. Unchanged files are left untouched; transient file locks receive bounded retries.

Missing data stays missing. Provisional values and breaks remain flagged. Raw charts keep each series at its original frequency. Derived comparisons use only the explicit alignment rules below; they do not infer causes or provide affordability assessments. No index supplies a property price, rent or personal income assumption.

## Comparative analytics

The Analytics page groups housing/earnings, housing/inflation, real-earnings trends and within-indicator country comparisons. The latter cover household economic conditions and borrowing-cost changes. The public demo uses Python-calculated `analytics.json`; the API uses the same functions. The client filters returned values and rankings rather than duplicating statistical formulas.

- **Housing and earnings:** exactly four quarterly HPI observations form a calendar-year arithmetic mean, then align to annual net earnings for that year. Each series is independently rebased: `100 × value / base value`.
- **Housing and inflation:** exactly three monthly all-items HICP levels form a quarterly mean. Nominal HPI is rebased to 100. The adjusted trend is `100 × (HPI / HICP) / (base HPI / base HICP)`. This is a consumer-price-adjusted index, not a real property price in EUR.
- **Real earnings:** exactly twelve monthly HICP levels form a calendar-year mean. The annual earnings/HICP ratio is rebased to 100. Its unnormalised ratio is not reported as consumer euros.
- **Country changes:** positive index or monetary series use common-base index changes. Inflation rates, overburden shares and borrowing rates use percentage-point differences. Rankings compare the same base and end periods; equal changes share a rank. A greater change is not necessarily a better outcome.

Partial-period means are unavailable. Missing interior periods remain chart gaps. A cumulative comparison stops at a source break; a break-period base may start the new segment. Consequently, the default earnings base is 2024, while a 2020 base ends at 2023. No growth across the 2024 compiler break is shown.

The screen offers the first compatible base period in each calendar year, plus the default post-break base where different, keeping static exports compact. Every compatible end period remains selectable. Base/end alignment includes all three countries even if one is hidden. The comparison API also accepts other valid base periods and country subsets.

Method references: [HPI annual aggregation](https://ec.europa.eu/eurostat/cache/metadata/en/prc_hpi_inx_esms.htm), [HICP annual averages](https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_ainr/default/table?lang=en). Source periods, original units, flags, missing-value reasons, retrieval dates and equations are available beside the charts and in analytical CSV exports.

The API follows [Eurostat's statistics API documentation](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/api). Attribution, source links and retrieval timestamps are included in the data exports and interface. Reuse conditions are described in [Eurostat's copyright notice](https://ec.europa.eu/eurostat/help/copyright-notice) and the [ECB's copyright and disclaimer notice](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html).

Rebased indices, aligned comparisons and percentage-point changes are calculations by Baltic Home Compass, rather than official Eurostat or ECB outputs. Eurostat and the ECB are not responsible for these calculations or their interpretation.

## Mortgage and household scenarios

Open **Calculators** to enter a purchase price, down payment in EUR or percent, nominal annual interest rate and term. Optional property costs and one-time expenses are included only when entered. Add monthly net household income, existing debt payments and non-housing spending for budget ratios and remaining income. An adjustable housing-to-income threshold is a personal assumption, not a lending rule or approval decision. Missing or zero income never produces an undefined ratio.

The same page provides a reverse purchase budget for a desired monthly principal-and-interest payment, customizable rate differences, annual/monthly amortization tables, remaining-balance and principal/interest charts. Values stay in React memory while navigating the app; refreshing the browser resets the scenario. No accounts, browser storage or financial database tables are introduced.

For principal `P`, monthly nominal rate `r = annual percent / 1200` and `n` monthly payments, payment is `P*r / (1-(1+r)^(-n))`; at zero interest it is `P/n`. The reverse formula is `P = M*(1-(1+r)^(-n))/r`, or `M*n` at zero interest. Down payments, monthly interest and actual payments use a reconciled cent ledger. Total interest and repayment sum that schedule; the final payment can differ from the regular payment and is shown explicitly. Each rate case applies its constant rate throughout the full original term. It is not a forecast or a mid-loan reset.

The manual rate is nominal, not APRC or an effective annual rate. The verified ECB AAR/NDER borrowing-cost series is displayed separately with its observation month, source, retrieval time and flags. Its composite definition cannot directly establish a nominal contract rate, so it is never automatically copied into the calculator. A missing benchmark leaves every calculator available. No statistical income or price index is converted into personal income or a property price.

Python's stateless `backend/app/mortgage.py` and the static demo's `frontend/src/finance.ts` implement [the shared mathematical specification](docs/calculations.md). Money inputs support two decimal places, rates six, and terms one to 720 whole months (60 years). The EUR 1 billion input limit and EUR 1 trillion reverse-result limit are numerical scope limits, not bank constraints. The page explains excluded costs and final-payment rounding, including unusually large reconciliation amounts at extreme rates.

In API mode, the browser calculates immediately and sends the scenario in an uncached POST body to `/api/calculators/mortgage` for a complete result check. The endpoint needs neither PostgreSQL nor live statistical APIs, returns typed results and uses `Cache-Control: no-store`. Request bodies are not logged or saved by the application. The page identifies verification failures and differences explicitly; browser calculations remain available. Static mode sends no financial values to a server. Use a trusted API base URL because API verification transmits the entered scenario to that configured server.

Local recovery archives and PostgreSQL dumps remain under the ignored `.local/recovery/` directory. They are not part of the repository or public build. Calculators require no financial database tables or additional migrations.

## Structure

```text
frontend/                   React, Vite, Tailwind, Recharts and client tests
frontend/public/data/       Original observations and precomputed analytics
backend/app/                FastAPI, configuration and database queries
backend/tests/              API and PostgreSQL constraint tests
pipelines/                  Metadata validation, ingestion and deterministic export
pipelines/tests/            Isolated parser, HTTP and export tests
database/migrations/        Versioned PostgreSQL schema
data/snapshots/             Previously retrieved official API responses
scripts/local-postgres.ps1  Native Windows PostgreSQL lifecycle
```

Tables separate countries, datasets, indicator definitions, observations and ingestion runs. The composite observation key and indicator/period index support country/date filtering. Migration 003 adds `v_house_price_annual`, `v_hicp_quarterly`, `v_hicp_annual` and `v_observation_year_over_year`. The aggregation views expose component counts and completeness; the window view checks the exact previous-year period and intervening breaks. No generated gap value is exported as a published observation. PG Insight remains outside scope.

API routes are `/api/health` (process liveness), `/api/ready` (database/schema readiness), `/api/indicators`, `/api/observations`, `/api/metadata`, and `/api/export`. Observation requests support `indicator`, comma-separated `countries`, frequency-appropriate `start`/`end`, `limit` and `offset`. Database unavailability returns HTTP 503, with no fabricated measurements.

`POST /api/calculators/mortgage` accepts the versioned scenario described in [the calculation specification](docs/calculations.md), with an OpenAPI example at `/docs`. It returns the mortgage summary, household ratios, reverse budget, rate cases and complete monthly/annual schedules. Invalid or unknown inputs return 422. Personal financial inputs are never written to PostgreSQL.

`/api/analytics/catalogue` returns the same prepared comparisons as the static analytics file. `/api/analytics/compare` accepts `metric` (`housing_earnings`, `housing_inflation`, `real_earnings` or `indicator_change`), `countries`, `base_period`, optional `start`/`end`, and `indicator` for `indicator_change`. Responses are typed and include methods, source metadata, exclusions and aligned rankings. Insufficient compatible data returns an explicit unavailable result; invalid requests return 422. The analytics response is compressed when supported by the client.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest -q

# The setup helper creates this separate test database.
$env:TEST_DATABASE_URL='postgresql://compass:compass@localhost:5433/compass_test'
.\.venv\Scripts\python.exe -m pytest -q
Remove-Item Env:TEST_DATABASE_URL

cd frontend
npm.cmd test
npm.cmd run build:static
npm.cmd run verify:static
npm.cmd run preview
```

Without `TEST_DATABASE_URL`, PostgreSQL integration tests are skipped. They apply migrations to the dedicated test database and isolate their test records. Small synthetic values remain inside test files and never enter production exports. `requirements.lock` records the verified Python environment; `frontend/package-lock.json` locks client dependencies.

Financial reference cases in `data/fixtures/mortgage-cases.json` are clearly labelled hypothetical test scenarios, independently evaluated with high-precision Decimal arithmetic; they are not official observations and are excluded from production exports. Frontend tests also compare full TypeScript and Python results for these cases plus 80 reproducible scenarios. Install the Python virtual environment before `npm.cmd test`; `BHC_PYTHON` may point to another Python executable with the backend dependencies installed. The production frontend and standalone calculators do not require Python.

The [release verification record](docs/release-verification.md) reports the commands actually run, test results, browser and accessibility checks, measured asset sizes and remaining limitations. Automated checks and practical keyboard checks are evidence for the reviewed flows, not a claim of complete WCAG certification.

`verify:static` checks the generated public artifact, including its data files and configuration. Financial regression tests cover zero rates, reverse budgets, cent rounding, reconciliation, input validation and API/static agreement. Calculator requests use POST bodies and `no-store` responses; the public static build sends no calculator inputs to a backend.

## Static deployment

`build:static` disables the API URL at compile time, even when `.env.local` enables it for development. The only directory to publish is `frontend/dist`; relative asset paths and hash navigation support a repository subpath. The build uses the committed official JSON/CSV files and precomputed analytics. Refreshing the source data remains an explicit local pipeline operation, followed by export, review and rebuild.

The [Cloudflare Pages guide](docs/deployment.md) documents a manual Direct Upload release and an optional private GitHub integration. It includes the exact build settings, free-plan limits, smoke checks and instructions for linking the eventual URL to GitHub and an existing portfolio. Deployment, account authorization, remote pushes and visibility changes remain manual actions.

## Limitations and possible improvements

- National series describe different populations and concepts. They cannot supply city-level prices, actual asking rents or personal household budgets.
- The included history begins in 2020 and is a periodically exported snapshot. Sources have different release schedules and may revise observations later.
- The 2024 earnings compilation break limits cumulative comparisons. Missing data and incomplete periods reduce the available comparison range.
- Mortgage simulations hold the entered nominal rate constant. Fees, tax, maintenance and insurance are included only through entered costs; forecasts, early repayments and bank eligibility rules are outside scope.
- Greater statistical change is not necessarily a better outcome. Correlation and relative rankings do not establish causes or loan suitability.
- Accessibility checks cover tested workflows; assisted screen-reader testing and broader browser/device testing would provide further evidence.

Possible later work includes longer verified history, additional accessible chart interactions, a documented data-refresh schedule and broader assistive-technology checks. These do not require accounts, commercial features or a hosted database for the public demo.

## Optional Docker configuration

`docker-compose.yml` is retained for future use. Nothing in the normal setup invokes it. To use it later, first stop the native project cluster to free port 5433, then run `docker compose up -d --wait`. The container uses a separate named volume; it does not automatically contain the native cluster's data. Do not run native and container servers on the same port. No existing database or Docker volume was deleted, and Docker-engine execution remains unverified.
