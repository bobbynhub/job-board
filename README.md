# Shortlist

A personal job board with live remote-job discovery, Apify dataset import, transparent profile matching, salary filtering, deduplication, application tracking, and company research notes. Built with native HTML, CSS, JavaScript, and Node.js. No framework, database service, or runtime package dependencies.

## GitHub Pages and privacy

`npm run build:pages` creates a static browser version in `dist/`. The **Publish job board** workflow tests it and deploys it on pushes to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the source once, then run or rerun the workflow. The expected address is `https://bobbynhub.github.io/job-board/`; that address is not proof a deployment has completed.

The public artifact contains a whitelist of application assets and fictional demo jobs. It never includes the local `data/` directory, uploaded résumé, credentials, or saved personal profile. The static app stores profiles, jobs, applications, company notes, and filtering preferences in this browser's local storage. Other visitors get their own independent boards. There is no account or automatic cross-device synchronization. Clearing site data deletes this local board. Someone with access to the same browser profile can read it. Storage is not encrypted or password protected, and other scripts on the same GitHub Pages origin share the browser's security boundary; only host trusted code under that account.

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
- **Import jobs** loads an existing Apify dataset by ID. Public datasets need no key. For private datasets, securely inject `APIFY_TOKEN` into the server environment. The token stays server-side. This app does not start paid actors, scrape LinkedIn directly, or schedule searches.
- JSON file import supports an array of up to 5,000 jobs and a 5 MB request limit. See the example below. Common Apify aliases `jobTitle`, `positionName`, `companyName`, `jobUrl`, `descriptionText`, and `experienceLevel` are accepted. Other actor schemas need mapping before import.
- Deduplication uses normalized company + title + location across sources. It preserves your existing job status. It may merge separate postings with identical identifying text and does not merge listings with different location spellings. Importing a duplicate does not refresh its fields.

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
