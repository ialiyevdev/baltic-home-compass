# CODEX MASTER PROMPT — BALTIC HOME COMPASS

## Your role

Work as a senior full-stack engineer and data analyst. Build a complete, reproducible **portfolio project** called **Baltic Home Compass** in this VS Code workspace. The application compares housing-price trends, net earnings, inflation, housing-cost pressure, purchasing power, mortgage affordability and household expenditure for **Latvia (LV), Lithuania (LT), and Estonia (EE)**.

This is a technical portfolio case study, **not a startup, SaaS product or commercial service**. Optimize for clear analysis, accurate calculations, a polished interface, clean implementation, and demonstrable engineering skills. Do not add user registration, payments, monetization, marketing funnels, subscriptions, chatbots, or social features. Do not invent datasets, prices, business outcomes or personal credentials.

**Implementation requirement:** Write code, text, and documentation in a restrained, natural, human-readable style. Prefer plain, specific names and straightforward functions over ceremonial abstractions. Add comments only where they explain a non-obvious business rule, statistical limitation, edge case, or technical decision; no comments narrating what simple code already does. Avoid excessive docstrings, boilerplate, generic AI-sounding phrasing, overengineered patterns, emoji-heavy UI copy, filler README sections, fake claims, and needless dependencies. Consistency, accuracy and maintainability matter more than looking clever. Preserve concise but necessary attribution, source notes and statistical caveats. Do not make unsupported claims about who wrote the code.

## Product goal

A visitor should be able to:

1. Compare LV, LT, and EE on actual economic and housing indicators.
2. See whether housing prices have grown faster or slower than representative earnings, while acknowledging differing statistical definitions and frequencies.
3. Enter **their own monthly net household income** and monthly essential spending to estimate how much they have left for housing.
4. Enter an **asking price** or assumed price, savings/down payment, mortgage interest rate, and term to estimate monthly payments and upfront cash needs.
5. Compare a **user-entered monthly rent** against an estimated ownership scenario, with clear assumptions.
6. Explore inflation, purchasing-power indices, and spending patterns without confusing macroeconomic aggregates with personal household expenses.
7. See dates, units, methodology, provenance, and limitations for every indicator.

Keep the initial experience focused: **Compare Countries**, **My Budget**, **Rent or Buy**, and **Data & Methodology**. Do not build irrelevant features. Support English UI and EUR amounts. Use correct country names and codes.

## Verified primary datasets (official sources)

Implement data-source adapters; make each source and dataset code configurable. Validate available dimensions and units from the API metadata before assuming codes.

- **Eurostat `prc_hpi_q` — House price index, quarterly:** https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table?lang=en
  - Use the total residential House Price Index and/or annual growth rate. Explain clearly that an index is not a price per square metre or average property listing price.
- **Eurostat `earn_nt_net` — Annual net earnings:** https://ec.europa.eu/eurostat/databrowser/view/earn_nt_net/default/table?lang=en
  - Choose and label a comparable earnings case, e.g. a single person without children at 100% of average earnings, annual net EUR. Do not present this as the median wage or typical individual salary. Monthly equivalent may be annual/12 only if labelled as such.
- **Eurostat `ilc_di03` — Mean and median equivalised income by age and sex:** https://ec.europa.eu/eurostat/databrowser/view/ilc_di03/default/table?lang=en
  - Select appropriate median, currency and population breakdown. This is equivalised income, **not** the net monthly income of an actual household.
- **Eurostat `prc_hicp_minr` — Monthly Harmonised Index of Consumer Prices and change rates:** https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en
  - Use current ECOICOP version 2 classifications. Be explicit whether displaying index level, month-on-month rate, or year-on-year inflation.
- **Eurostat `ilc_lvho07d` — Housing cost overburden by urbanisation:** https://ec.europa.eu/eurostat/databrowser/view/ilc_lvho07d/default/table?lang=en
  - Explain what this indicator measures, including definition and population group.
- **Eurostat `prc_ppp_ind_1` — Price level indices and purchasing power, COICOP 2018:** https://ec.europa.eu/eurostat/databrowser/view/prc_ppp_ind_1/default/table?lang=en
  - Select a meaningful and comparable indicator; do not mislabel PPS or price-level indices as consumer euros.
- **Eurostat `nama_10_cp18` — Household final consumption expenditure by purpose:** https://ec.europa.eu/eurostat/databrowser/view/nama_10_cp18/default/table?lang=en
  - This is national-accounts expenditure, not an individual's budget. Use for macroeconomic composition charts only, and choose/report units appropriately.
- **ECB MIR — Cost of borrowing for household house-purchase loans:** https://data.ecb.europa.eu/data/datasets/MIR
  - Investigate the monthly cost-of-borrowing series for EE, LV and LT, e.g. keys of the form `MIR.M.<COUNTRY>.B.A2C.AM.R.A.2250.EUR.N`, and verify each on ECB before use. A national borrowing-cost indicator is **not a personalized bank offer** or necessarily APRC. If a series cannot be verified or retrieved, expose the user's rate input and omit that benchmark instead of faking values.

Official Eurostat API instructions: https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/api
API base: `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/`

Use `geo=LV`, `geo=LT`, and `geo=EE` where valid. Handle JSON-stat dimension ordering properly, status flags, missing observations, breaks in series and publication metadata. Use an official ECB data API/CSV route according to its documentation, not unreliable scraping of rendered webpages.

### Data availability rules

- Use only verified downloaded measurements and clearly distinguished user inputs/assumptions.
- Do not substitute house-price growth rates for apartment asking prices.
- Do not claim to provide actual rent listings or city-level home prices without verified city-level sources.
- Do not fabricate a latest month/quarter if the publisher has not released it.
- Do not mix annual, quarterly and monthly measurements as if they were simultaneous. Display as-of dates for each series and align periods explicitly for any derived comparison.
- Preserve original value, unit, time frequency, observation status, source URL and update time.
- When sources are temporarily unavailable, use a **committed snapshot of previously retrieved, real, attributed data**. Development fixtures must remain marked and excluded from the production site.
- Follow publisher terms, attribution and reasonable API request limits. Implement retry, timeout, caching and idempotent upserts.

## Technical stack

Use a compact but substantial end-to-end architecture:

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Recharts (or another small maintained chart library if justified).
- **Backend:** Python 3.12+, FastAPI, Pydantic and SQLAlchemy or psycopg 3. Use a small, explicit service layer rather than unnecessary architecture.
- **Database:** PostgreSQL with migrations (Alembic or concise SQL migrations).
- **ETL/analysis:** Python with httpx/requests and pandas; use explicit validation and small pure calculation modules.
- **Testing:** pytest for pipelines, APIs and financial calculations; Vitest and React Testing Library for client behaviour.
- **Development:** Docker Compose for local PostgreSQL, a `.env.example`, and simple PowerShell-compatible instructions for Windows 11 and VS Code.
- **Portfolio deployment:** support a **static public demo** on Cloudflare Pages or GitHub Pages using build-time exported, verified datasets and client-side calculators. Do not require a permanently hosted FastAPI/PostgreSQL backend to view the public project. The real full-stack implementation must remain runnable locally and fully documented.

Choose versions that work together; check the existing workspace and currently installed tooling first.

## Functional sections

### 1. Compare Countries

- Fixed country selector for LV/LT/EE; allow comparing two or all three.
- Charts: house price index and annual growth, earnings, inflation, housing-cost overburden, and price level comparisons.
- Date-range selectors where meaningful.
- Show units, dates and metadata directly next to charts.
- Short, readable explanations for changes. Do not make unsupported causal claims.
- Offer CSV export for displayed/filtered statistics.

### 2. My Budget

Inputs: country, number of adults (optional), monthly net household income, monthly essential non-housing spending, optional debts/loan payments and planned housing payment.

Outputs: remaining monthly budget, housing-to-income ratio, housing plus essential expenses, an adjustable affordability reference, and a transparent warning when the budget is negative.

This is a scenario calculator, not a bank's underwriting decision or individualized financial advice. Do not invent city-specific cost-of-living numbers. If preset example budgets exist, mark them clearly as hypothetical and do not label them national averages.

### 3. Rent or Buy

Inputs: user-entered property price, monthly rent, down-payment amount or percentage, mortgage term (years), annual interest rate, and optional taxes/insurance/maintenance and upfront fees. Optional country-based reference mortgage rate only where supported by official series.

Outputs:
- Loan principal = price minus down payment.
- Monthly principal-and-interest payment using the standard amortizing payment formula; correct zero-rate special case.
- Monthly ownership cash outflow including optional costs.
- Initial cash requirement including down payment and user-specified fees.
- Simple monthly cash-flow comparison versus rent.
- Mortgage schedule / interest and principal breakdown, when feasible.
- A clearly labelled scenario comparison, **not** an unsupported claim that buying always beats renting. Avoid misleading break-even calculations if appreciation, taxes, maintenance, rent growth, investment returns or transaction costs are omitted.

Use accurate validation for zero/negative values, high rates, full cash purchases, non-integer years and currency rounding. Test with independently calculated examples.

### 4. Data & Methodology

- Each indicator: official dataset name and code, geographic scope, unit, frequency, source URL, last successful ingestion, latest observation, and explanation.
- Explain major limitations in plain English.
- Show data completeness and pipeline status.
- Describe how derived indicators are computed.

## Design direction

Treat this as a thoughtful public-interest data visualization project, not a brand-heavy startup landing page.

Design a calm, original, professional, responsive interface. Use high-quality typography, restrained color, neutral backgrounds, precise spacing, and clean charts. Avoid bright gradients, generic AI-looking cards, excessive animation, fake testimonials, pricing, signup CTAs, and dramatic marketing copy. The UI should look like a credible research/analytics tool built carefully by a developer. Mobile layout must be useful, not merely compressed. Support accessible chart descriptions and keyboard navigation.

## Data and database design

Design relational tables around data provenance and measured indicators. A reasonable foundation includes:

- `countries` (only EE/LV/LT)
- `datasets` (publisher, source URL, code, update frequency, license/attribution)
- `indicators` (definition, unit, dimensions, method)
- `observations` (country, indicator, period, original value, selected dimension values, source status)
- `ingestion_runs` (start/end, status, error details, row counts)

You may choose better normalized structure where needed. Use constraints, unique keys for idempotent updates, indexes on `country`, `indicator`, and period, and clear migrations. Store raw API responses or small reproducible snapshots separately when appropriate. Do not flatten unrelated statistical concepts into a single ambiguous numeric column without metadata.

Add useful SQL views for repeated analytics and examples of window functions (e.g. year-over-year changes), with careful treatment of missing previous periods.

This project **does not require creating the PG Insight PostgreSQL extension yet**. Keep validation modular and document possible integration later; do not derail scope by building a second product inside this repository.

## Data engineering requirements

- A command such as `python -m pipelines.sync` should fetch selected official datasets, normalize them and update PostgreSQL reproducibly.
- A command such as `python -m pipelines.export_static` should export only validated/attributed observations to the frontend's production-consumable JSON/CSV assets.
- Support pagination/filtering, timeouts, retries, and polite request rates as appropriate to each provider.
- Validate country codes, units, dates, duplicates, impossible values, allowed indicators, and completeness.
- Preserve series-specific flags and source notes; never silently fill missing values.
- Log each ingestion run without excessive noise.
- Expose optional FastAPI endpoints for indicator listing, observation filtering, metadata and comparison values; test them.
- Build deterministic static data exports so the deployed public interface works independently of any backend server.
- If internet access is unavailable within Codex, implement the adapters and parsers against isolated, labelled test fixtures; document the blocker and do not pretend the final datasets were downloaded.

## Suggested workspace structure

```text
baltic-home-compass/
  frontend/
    src/
    public/data/
  backend/
    app/
    tests/
  pipelines/
  database/
    migrations/
    sql/
  data/
    snapshots/
    fixtures/
  docs/
  docker-compose.yml
  .env.example
  README.md
```

Adapt when useful; don't create unused folders merely to match this example.

## Delivery phases

**Phase 1 — Audit and foundation**: inspect workspace, pick compatible dependencies, establish minimal project structure, compose PostgreSQL, create schema and migrations, and a working frontend shell.

**Phase 2 — Real data acquisition**: verify dataset dimensions and fetch at least house prices, earnings and inflation for all three countries. Build parsers, provenance, upserts and quality tests. Add the remaining official indicators progressively.

**Phase 3 — Real analytics**: implement SQL views, comparison logic, period alignment, and API endpoints. Prove calculations with tests.

**Phase 4 — Useful interface**: implement Compare Countries, My Budget, Rent or Buy and Data & Methodology. Render only real data and labelled user assumptions; provide genuine empty and error states.

**Phase 5 — Portfolio publishing**: generate static exports, produce a working static build, add short documentation and a screenshot/video guidance section, and verify it can be deployed free without running paid infrastructure.

**Phase 6 — Quality control**: run builds, tests, formatting/linting, data validation and responsive checks. Fix issues before declaring the work complete. If browser automation is available, inspect desktop and mobile rendering; otherwise state what wasn't tested.

## Code and documentation expectations

- Straightforward Python and TypeScript; small focused modules and meaningful function names.
- No excessive inline comments. Use comments only for non-obvious logic or important statistical caveats.
- No huge docstrings describing self-evident functions; use typing and clean interfaces.
- No broad `except:` blocks swallowing errors or fragile one-off notebook code in the main application.
- No fabricated placeholders dressed up as official statistics.
- No vague AI-sounding prose such as “revolutionizing the future of housing intelligence.”
- README should explain the real problem, datasets, architecture, setup, limitations, testing, and portfolio demo in a natural developer voice, with honest claims.
- Document actual decisions and trade-offs (why Eurostat over scraped listings; why local PostgreSQL plus static public export; differing frequencies; pricing index limitations).
- Do not claim performance scores, test coverage, analysis results or live deployments that have not been measured.

## Acceptance criteria

- Real official data from EE/LV/LT can be fetched, normalized and reproduced.
- Data sources and transformations are documented and auditable.
- PostgreSQL schema and migrations work locally.
- Automated API, pipeline and calculator tests pass.
- Users can compare genuine historical housing and economic indicators.
- Users can enter their own numbers and get correct mortgage and budget calculations.
- The public static build works without PostgreSQL or FastAPI being online.
- No fake property prices, monthly wages, rent figures or results appear as real data.
- The UI is polished, responsive, readable and useful.
- Source code reads naturally and doesn't contain unnecessary comments, filler boilerplate or generic AI-generated copy.

## Execute now

Inspect this workspace and available tools. Produce a short implementation plan, then begin creating the actual files and making the first end-to-end vertical slice work: **official Eurostat data → validated PostgreSQL records → exported/static client data → working comparison chart**. Do not stop at planning or a mock interface. Continue into the calculators and other pages as feasible, prioritize a coherent working MVP over superficial completeness, and report the commands actually run, test results, remaining work, and how to preview/deploy the project.
