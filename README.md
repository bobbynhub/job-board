# Shortlist

A personal job board with live remote-job discovery, Apify dataset import, transparent profile matching, salary filtering, deduplication, application tracking, and company research notes. Built with native HTML, CSS, JavaScript, and Node.js. No framework, database service, or runtime package dependencies.

## GitHub Pages and privacy

`npm run build:pages` creates a static browser version in `dist/`. The **Publish job board** workflow tests it and deploys it on pushes to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the source once, then run or rerun the workflow. The expected address is `https://bobbynhub.github.io/job-board/`; that address is not proof a deployment has completed.

The public artifact contains a whitelist of application assets and fictional demo jobs. It never includes the local `data/` directory, uploaded résumé, credentials, or saved personal profile. The static app stores profiles, jobs, applications, company notes, and filtering preferences in this browser’s IndexedDB storage (with a local-storage fallback). Other visitors get their own independent boards. There is no account or automatic cross-device synchronization. Clearing site data deletes this local board. Someone with access to the same browser profile can read it. Storage is not encrypted or password protected, and other scripts on the same GitHub Pages origin share the browser's security boundary; only host trusted code under that account.

No analytics or résumé uploads are included. Public job searches fetch the Remotive catalog and filter locally; the full skills profile and salary preferences are never sent to a provider. Company research sends only the company name to Wikipedia. Public Apify dataset import sends the dataset ID. For private Apify datasets on Pages, upload a JSON export instead of putting a token into frontend code.

Open **My profile** to download or import a profile JSON file privately. A downloaded profile contains personal preferences; keep it outside the repository. The cloud app's existing profile is not automatically published or transferred to Pages. Enter it there or import its downloaded profile file. Browser networking requires provider CORS support; connection/provider errors are reported, and JSON import remains available.

## Run

Requires Node.js 24.5 or newer (uses native environment-proxy support for HTTPS requests).

```sh
npm ci
npm test
npm start
# Or: npm run dev
```

The server listens on `127.0.0.1:3000` by default. Set `PORT` or `HOST` as needed. It is a **single-user local application without authentication**; add authentication before exposing it on a public network. Personal data is saved atomically in ignored `data/board.json`. Override with `DATA_DIR`. Back up this file to retain your board. Tests use temporary isolated data.

The first run includes explicitly fictional demo jobs. Remove them using the banner. The demo descriptions and compensation are examples, not current vacancies. No personal résumé, profile, or credentials are committed.

## Personal fit

Open **My profile** to enter target titles, skills, years of experience, seniority, annual salary floor/currency, preferred work style, and optional location. Target titles accept “architecture”/“architect”, “solutions”/“solution”, and “engineering”/“engineer” variants. Optional strict title/seniority filtering applies to Discover. Remote is a ranking preference unless you choose the separate work-style filter.

Fit scores are explainable keyword and preference matching, not hiring predictions or semantic résumé analysis. Click a score to inspect matched/missing skills and cautions. Years of experience are compared only when a job supplies `minExperience`. Location matching is textual; always verify residency and work authorization with the employer.

Salary filtering uses **annual base pay** supplied as numeric `salaryMin` / `salaryMax` in your currency. No exchange rates, OTE-to-base conversion, hourly annualization, or inference from raw salary text. Ranges that only partly meet your floor are labeled. Unstructured/undisclosed pay and other currencies remain unverified and can be hidden. Filters apply to the visible tab; strict role and exclusion preferences apply only to Discover. Reset clears manual filters, retaining your saved profile salary floor.

## Live search and imports

- **Search live jobs** queries the public Remotive API for the entered role. Results are remote-only and may restrict location. The public catalog is cached on disk for six hours, respecting the provider’s recommendation of at most four daily requests. Search terms are applied locally to the title and description; sponsored listings do not bypass these checks. Attribution and original links remain on every job. Salary text from this source is displayed but not inferred into structured annual base pay. This is not exhaustive search across job sites. Search separate role variants to broaden coverage.
- **Import jobs** loads an existing Apify dataset by ID. Public datasets need no key. For private datasets, securely inject `APIFY_TOKEN` into the server environment. The token stays server-side. This app does not start paid actors, scrape LinkedIn directly, or start paid scheduled runs. Scheduled public company collection is described below.
- JSON file import supports an array of up to 5,000 jobs and a 5 MB request limit. See the example below. Common Apify aliases `jobTitle`, `positionName`, `companyName`, `jobUrl`, `descriptionText`, and `experienceLevel` are accepted. Other actor schemas need mapping before import.
- Deduplication uses normalized company + title + location across sources. It preserves your existing job status. It may merge separate postings with identical identifying text and does not merge listings with different location spellings. Repeated imports preserve review history and can enrich existing descriptions and original-posting links.

```json
[
  {
    "title": "Principal Enterprise Architect",
    "company": "Example",
    "location": "United States",
    "workMode": "Remote",
    "seniority": "Principal",
    "description": "Enterprise integration, ERP, governance, SQL, Azure",
    "salaryMin": 210000,
    "salaryMax": 260000,
    "currency": "USD",
    "minExperience": 15,
    "postedAt": "2026-10-25",
    "url": "https://example.com/jobs/1"
  }
]
```

## Feedback and company research

Save interesting jobs, mark applications, or discard with a reason. Discard reasons remain attached to the job. The company exclusion checkbox and excluded keyword preferences filter future imports and Discover; reasons alone do not silently retrain anything. Restore discarded jobs from their details.

Company research searches Wikipedia for potential matches and shows source links/snippets. Confirm company identity before using a result. Save reviewed evidence and notes on team, industry, mission, and concerns. Team size and industry are displayed only when provided by an import; ethical ratings are not invented. Automated multi-source company enrichment is not implemented.

Network destinations: `remotive.com` (live search), `api.apify.com` (dataset import), `en.wikipedia.org` (public company research). Provider/network failures appear as errors and never substitute demo results.

## Validation

`npm test` exercises real HTTP endpoints, profile persistence, transactional import validation, deduplication, save/apply/discard/restore, company notes, exclusions, demo removal, unsafe link rejection, role aliases, skill boundaries, experience matching, salary boundaries, and cross-origin write rejection. There is no compilation or separate build step.

## Scheduled company collection and Apify

GitHub Actions now collects public company career listings every six hours, at minute 17 UTC (GitHub may delay scheduled runs). The same workflow runs when `main` changes or when manually dispatched. `config/job-sources.json` lists the initial Greenhouse, Lever, and Ashby boards. This is a configured company list, not a crawl of every job board on the internet. `npm run crawl` generates the public `public/jobs-feed.json`, and the Pages build includes it. These generated listings are ignored by Git, refreshed by the workflow, and contain only public job fields. No user profile or private filtering preferences are read during collection.

The website syncs the published feed on load, every 15 minutes while the tab is visible, or when **Sync latest jobs** is clicked. Sync fetches the most recently published collection; it does not immediately launch the crawler. The feed panel shows the collection timestamp and per-source coverage. Original application links are preserved. Existing listing details update while saved/applied/discarded states and feedback remain private and unchanged. A listing missing from a successful source refresh is marked closed and removed from Discover, with its saved/application history retained. During a source outage the previous source snapshot remains visible and is labeled stale; if every source fails, deployment fails and the previous site stays online. Unknown or unstructured compensation remains unverified rather than being assumed to meet the salary target.

Apify integration reads existing public/private datasets or the most recent successful run of a saved task. It does **not** automatically launch paid actors. Create/schedule the actual scraper task inside your Apify account, using an actor suited to the desired job boards. Then configure this repository under **Settings → Secrets and variables → Actions**:

- Secret **APIFY_TOKEN**: your Apify API token, needed for private datasets or tasks. Never put it in code, a URL, browser local storage, or chat.
- Variable **APIFY_TASK_ID**: your saved task ID (or `username~task-name`). Its most recent successful dataset is imported at the next collection.
- Alternatively, variable **APIFY_DATASET_IDS**: a comma-separated list of up to ten dataset IDs. Public datasets work without a token. A fixed dataset must be updated by its source if it is expected to contain fresh jobs.

After saving these settings, run **Publish job board** from the Actions tab to collect immediately, or wait for the next scheduled run. Task execution frequency and spending limits belong in your Apify task/account configuration. Scraping and synchronization are separate schedules. The integration uses authenticated read-only requests, retrieves dataset pages, and applies an explicit whitelist of job fields. Raw actor inputs, credentials, dataset IDs, private metadata, and user profiles are excluded from the published feed. Only public vacancy content should be supplied to this integration, since that content is published to the public site.

Common Apify field aliases are supported, including `title`/`jobTitle`/`positionName`, `company`/`companyName`, `location`, `url`/`jobUrl`/`link`, and `description`/`descriptionText`/`jobDescription`. Missing company/application URLs or unsupported schemas produce an explicit source error rather than partial imports. Numeric Apify salary ranges require an explicit annual salary interval; other salary text is shown without assuming it is annual base pay. Different actors may need an adapter after their output is inspected. Dataset imports are limited to fewer than 5,000 rows per dataset.

## Private geography and citizenship preferences

My profile includes **Country focus** and optional citizenship preferences. **U.S. first, plus Canada** filters Discover to recognized U.S./Canadian locations and ranks U.S. results first within Best fit. Worldwide remote and unspecified remote locations each require separate opt-in. Remote alone does not establish country eligibility. Country detection is conservative and uses the listing's location text; ambiguous roles may need manual review or the unknown-location option. Explicit North American remote locations are included with a verification note.

An optional overseas exception includes roles explicitly requiring citizenship that matches the private profile. Casual company references to the U.S., or statements that citizenship is not required, do not qualify. This textual check does not verify visas, security clearances, local work rights, or employer sponsorship. All preferences and citizenship selections stay in browser storage (or the separate local cloud state); they are not published in the job feed or sent to scraper providers. Saved/application history remains accessible when preferences change. Default public profiles do not assume a country or citizenship.

For a daily Apify task with the verified HarvestAPI pricing of $0.001 per job plus $0.001 per actor start, three U.S.-only queries limited to 40 results each cost approximately $0.121 per run, or $3.75 for 31 daily runs, before any other account usage. Start with 10 per query for one small test run. Scraper prices can change; review the actual run charge and set a per-run maximum in Apify. Adding Canada as a second scraper location doubles query/location combinations at the same per-query limit; the free company feeds already include Canadian listings. Daily paid scraping is not activated just by saving APIFY_TOKEN: a saved task, successful test run, APIFY_TASK_ID, and task schedule are still required.

The collector can also discover the private task automatically when APIFY_TOKEN is present: it selects the task named `shortlist-us-daily`, or the sole task using the supported HarvestAPI actor. Ambiguous selections require APIFY_TASK_ID. This discovery makes read-only API calls and never publishes task identifiers.

The **Publish job board** manual workflow has an optional **configure_daily_apify** input. This explicit setup action verifies the account's free-plan monthly credit, the actor's event pricing, three U.S.-only searches, and an already successful importable test run before making any changes. It then sets 40 items per query, a 120-item overall run limit, a $0.13 per-run charge limit, a five-minute timeout, and no automatic error restarts. A single private Apify schedule runs at 7 AM America/New_York. Setup does not start another run immediately. It refuses paid plans, changed prices, unexpected inputs, public tasks, or conflicting existing schedules. Estimated event charges are $3.75 per 31-day month; other account usage can consume remaining credits. Apify's free-plan exhaustion behavior still applies. Ordinary six-hour website refreshes only read the latest completed dataset.

If a first test was started directly from the actor rather than a saved task, supply its successful run ID in the manual workflow's **apify_run_id** field alongside **configure_daily_apify**. Setup validates the actor, account credit, pricing, U.S.-only input and importable dataset before creating a private saved task from that input. It does not run the actor again. The new task retains a private reference to the initial run so its results remain importable until the first scheduled task run succeeds. Normal collectors never publish this reference or actor inputs. Existing tasks associated with a run are reused. Setup continues to enforce the same run caps and single daily schedule.

## Reviewing job listings

Cards include Company, View role, Mark applied (or Back to feed), Discard (or Restore job), and a compact Apply link, plus Save and Collapse controls. Apply opens the direct company application page when supplied, falling back to the original source posting. It does not automatically mark an application submitted. Discard still asks for a reason.

Collapse leaves only the company name and job title in a small expandable row. This private choice persists in the same browser’s IndexedDB across page reloads and revisits. Feed updates preserve collapsed, saved, applied/discarded status, and discard reasons. Existing stable source posting references are also matched so title/location edits retain the same local review history. Listings without stable source references fall back to the normalized company/title/location identity. A genuinely new or unrecognized posting can still appear as a new result. Source fetching and private state writes are serialized appropriately so a refresh response does not overwrite a review action made while data was downloading.

Collectors retain source HTML separately from searchable text, including Lever requirements lists and additional sections. The description dialog reconstructs an allowlisted document with headings, nested bullets, numbered lists, paragraphs, emphasis, tables, and safe external links. Scripts, frames, images, event handlers, and arbitrary styles are not attached to the page. Plain-text listings get paragraph and bullet formatting; original structure that the provider does not supply cannot be reconstructed perfectly. Rich formatting is refreshed from current source data without another paid scrape. Existing archived jobs retain whatever description is available.
