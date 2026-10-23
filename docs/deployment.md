# Static deployment

The release artifact is `frontend/dist`. It contains the React application, verified statistical exports and browser financial calculations. FastAPI and PostgreSQL are development and ingestion services; they are not required by the published demo.

No hosting project has been created and no files have been uploaded during release preparation. The GitHub repository remains private. The steps that authorize an account, push changes or publish a site below are future manual actions.

## Hosting choice

Use **Cloudflare Pages Free with Direct Upload** for the first release. Build locally, review the output, then upload only that output. There is no Git connection and no automatic publication when a commit is made. A Direct Upload project cannot later be converted to Git integration; that would require a new Pages project. See [Cloudflare's Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/).

Cloudflare's documented Free limits include 500 builds per month, 20,000 files per site and a 25 MiB maximum per asset. This application needs no Pages Functions, paid database, custom domain or other paid resource. Review the current [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) before publishing; provider plans can change. The release's measured artifact sizes are recorded in [release verification](release-verification.md).

## Build and inspect locally

Use Node.js **24.16.0**, pinned by `frontend/.node-version`. From the repository root:

```powershell
cd frontend
npm.cmd ci
npm.cmd run build:static
npm.cmd run verify:static
npm.cmd run preview
```

Open <http://127.0.0.1:4173>. The build reads the three committed files under `frontend/public/data/`; it does not query the database or official APIs. The static build explicitly disables `VITE_API_BASE_URL`, including when an ignored `.env.local` enables the API during development. Do not add database URLs, passwords, tokens or other private configuration to Vite environment variables: client variables become public code.

Before uploading, check:

1. Compare Countries loads, country/date selection works and CSV downloads contain the displayed statistical scope.
2. Analytics loads, including housing/earnings and a before-break earnings base; missing observations remain unavailable.
3. Calculators work with FastAPI stopped. Change a hypothetical price, rate and term; inspect scenarios and the final zero balance.
4. Data & Methodology shows source links, units, flags and the snapshot timestamp. A snapshot is not a live data feed.
5. At mobile width, navigation, controls and tables remain usable. Tab through the page and check visible focus.
6. Open the deep links below directly and reload each. Browser Network should show local static assets and data, with no requests to localhost ports or `/api/`.

Hash navigation needs no path rewrite. Relative Vite assets also support hosting below a directory. Financial values are kept in React memory and are not included in URLs.

| Destination | Append to the published base URL |
| --- | --- |
| Country dashboard | `#compare` |
| Comparative analytics | `#analytics` |
| Data definitions | `#methodology` |
| Mortgage inputs | `#calculators/mortgage-calculator` |
| Household ratios | `#calculators/household-calculator` |
| Reverse budget | `#calculators/purchase-budget` |
| Rate scenarios | `#calculators/rate-scenarios` |
| Repayment schedule | `#calculators/amortization` |

`frontend/public/_headers` is copied into `dist` for Pages security and cache rules. Pages interprets this file; Vite preview is not a test of provider response headers. Inspect those headers after the first deployment. See [Cloudflare's headers documentation](https://developers.cloudflare.com/pages/configuration/headers/).

## Publish manually with Direct Upload

These steps publish a public website, even though the source repository stays private. Compiled browser code and statistical exports become publicly downloadable. Perform them only when the release is approved for publication.

1. Sign in to a Cloudflare account on the Free plan.
2. Open **Workers & Pages → Create application**, choose **Pages**, then the **Drag and drop / Upload assets** option.
3. Choose an available project name. Upload the **contents of `frontend/dist`**, as a folder or ZIP with `index.html` at its root. Do not upload the repository.
4. Review the files and select **Deploy site / Save and Deploy**. Copy the actual URL Cloudflare provides; no live URL is assumed in this repository.

The dashboard accepts folders and ZIP files, with a 1,000-file upload limit. This differs from the Wrangler limit. The provider's [upload instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/) describe both methods.

To make a ZIP locally, run from `frontend/`:

```powershell
New-Item -ItemType Directory -Path ..\.local\release -Force | Out-Null
Compress-Archive -Path .\dist\* -DestinationPath ..\.local\release\baltic-home-compass-pages.zip -Force
```

Optional CLI alternative, also a publishing action, from `frontend/`:

```powershell
npx.cmd wrangler login
npx.cmd wrangler pages project create baltic-home-compass --production-branch main
npx.cmd wrangler pages deploy .\dist --project-name baltic-home-compass --branch main
```

Use the project name actually created if that name is unavailable. Wrangler is not an application dependency; `npx` may ask to install it. No API token belongs in the repository.

## Optional private GitHub integration

Cloudflare Pages supports both private and public GitHub repositories. A public demo does not require making this repository public. Connecting Git gives Cloudflare access to the selected repository and normally starts automatic builds after pushes. The first **Save and Deploy** publishes a deployment, so this setup is also a future approval-dependent action. See [Cloudflare's Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/).

If choosing Git integration instead of Direct Upload:

1. When approved, push the reviewed local release commits to the existing private remote.
2. In Pages, choose **Connect to Git → GitHub**. Authorize only `ialiyevdev/baltic-home-compass` and select it.
3. Use the settings below. Do not accept a preset's generic `npm run build` command.
4. After the initial approved release, disable **Enable automatic production branch deployments** and set preview branches to **None** if every later publication should remain manual. See [branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

| Setting | Value |
| --- | --- |
| Framework preset | None; use the explicit command below |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build:static && npm run verify:static` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=24.16.0` |
| Environment variable | `SKIP_DEPENDENCY_INSTALL=1` |
| API/database variables | None |

The explicit `npm ci` uses the committed lockfile; `SKIP_DEPENDENCY_INSTALL` avoids a separate automatic install. Cloudflare supports a numeric Node override through `NODE_VERSION` or `.node-version`; its default Node version may differ. The v3 build image does not infer Node from `package.json` engines. These settings follow the official [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [build image](https://developers.cloudflare.com/pages/configuration/build-image/) documentation.

For a manual Git-integrated update, use the Pages deployment controls to retry an approved commit, or deploy reviewed assets using Wrangler. Keep automatic production and preview deployments disabled during private development. Do not add a deployment workflow merely to prepare this release.

## Verify and link the actual live demo

After an approved deployment, repeat the smoke checks against the assigned HTTPS URL. Confirm the data snapshot timestamp, the absence of localhost/API requests and the Pages response headers. Local verification cannot prove provider-specific deployment behavior before a site exists.

Then connect the real URL to the project:

1. On the [GitHub repository](https://github.com/ialiyevdev/baltic-home-compass), use the **About** section's settings to set **Website** to the live demo URL. This does not change repository visibility.
2. Add `[Live demo](ACTUAL_HTTPS_URL)` near the top of the README, replacing the token with the copied URL. Commit and push that documentation change only when authorized.
3. On the existing personal portfolio, add a Baltic Home Compass project entry using the [prepared description and genuine screenshots](portfolio.md). Set the main action to **Live demo** and the case-study action to the relevant portfolio page.
4. A public **Source code** link will not grant access to this private repository. Omit it or label it **Private repository; available on request** until a separate decision is made about source visibility. Do not change visibility as part of deployment.
5. Test the portfolio links while signed out of both GitHub and Cloudflare. Confirm that the live demo opens and that no public link implies access to private source.

## Update the statistical snapshot

The public site does not refresh official APIs in a visitor's browser. To release updated data, stop a running Vite server, start the local PostgreSQL instance, and run from the repository root:

```powershell
.\scripts\local-postgres.ps1 start
.\.venv\Scripts\python.exe -m pipelines.sync --refresh
.\.venv\Scripts\python.exe -m pipelines.export_static
```

Review source dates, flags, revisions and changed exports; run the tests and static build again. Commit the reviewed changes locally. Upload the new `dist` only after the new publication is approved. A failed ingestion preserves earlier observations and must be investigated rather than presented as a successful refresh.
