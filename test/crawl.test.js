import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapJobs,
  combineResults,
  sourceUrl,
  plainText,
} from "../scripts/crawl-lib.js";
import { collectApify } from "../scripts/apify-jobs.js";
import { syncFeed } from "../public/feed-sync.js";
const source = { provider: "greenhouse", board: "example", company: "Example" };
const green = {
  jobs: [
    {
      id: 1,
      title: "Principal Enterprise Architect",
      absolute_url: "https://example.com/1",
      location: { name: "Remote, US" },
      content: "&lt;p&gt;SQL &amp; ERP&lt;/p&gt;",
    },
    { id: 2, title: "Office Manager", absolute_url: "https://example.com/2" },
  ],
};
test("career feed adapters keep real role data, skip unrelated roles, and do not infer annual pay", () => {
  const jobs = mapJobs(source, green);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workMode, "Remote");
  assert.equal(jobs[0].seniority, "Principal");
  assert.equal(jobs[0].description, "SQL & ERP");
  assert.equal(jobs[0].salaryMin, 0);
  const lever = { provider: "lever", board: "example", company: "Example" };
  const row = {
    text: "Senior Solutions Engineer",
    hostedUrl: "https://example.com/3",
    categories: { location: "US" },
    salaryRange: {
      min: 210000,
      max: 250000,
      interval: "per-year",
      currency: "USD",
    },
  };
  assert.equal(mapJobs(lever, [row])[0].salaryMin, 210000);
  assert.equal(
    mapJobs(lever, [
      { ...row, salaryRange: { ...row.salaryRange, interval: "per-month" } },
    ])[0].salaryMin,
    0,
  );
  const ashby = mapJobs(
    { provider: "ashby", board: "example", company: "Example" },
    {
      jobs: [
        {
          title: "Lead Solutions Architect",
          isListed: true,
          jobUrl: "https://example.com/4",
          location: "New York",
          isRemote: false,
          compensation: { compensationTierSummary: "USD 200,000–250,000" },
        },
      ],
    },
  );
  assert.match(ashby[0].salaryText, /200,000/);
  assert.equal(ashby[0].salaryMin, 0);
  assert.throws(() => sourceUrl({ ...source, board: "../private" }));
  assert.equal(plainText("&#x26; &#38;"), "& &");
});
test("partial outages retain old listings and all-source failure prevents publishing an empty feed", () => {
  const old = mapJobs(source, green);
  const previous = {
    jobs: old,
    sources: [
      { id: "greenhouse:example", status: "ok", checkedAt: "2026-10-24" },
    ],
  };
  const fresh = { provider: "lever", board: "fresh", company: "Fresh" };
  const feed = combineResults(
    [
      { source, error: "HTTP 503" },
      { source: fresh, jobs: [] },
    ],
    previous,
    "2026-10-25",
  );
  assert.equal(feed.jobs.length, 1);
  assert.equal(feed.sources[0].status, "stale");
  assert.equal(feed.sources[0].lastSuccessAt, "2026-10-24");
  assert.throws(
    () => combineResults([{ source, error: "HTTP 503" }], previous),
    /All career sources failed/,
  );
});
test("sync refreshes pay while preserving personal decisions and marks disappeared jobs closed only for healthy sources", () => {
  const [job] = mapJobs(source, green);
  const profile = { skills: ["SQL"], salaryMin: 200000 };
  const state = {
    profile,
    jobs: [
      { ...job, status: "applied", saved: true, reason: "Personal note" },
      { ...job, id: "missing", status: "feed" },
      { ...job, id: "stale", feedSource: "lever:down", status: "feed" },
    ],
  };
  const feed = {
    version: 1,
    generatedAt: "2026-10-25",
    jobs: [{ ...job, salaryMin: 230000 }],
    sources: [
      { id: "greenhouse:example", status: "ok" },
      { id: "lever:down", status: "stale" },
    ],
  };
  syncFeed(state, feed);
  const saved = state.jobs.find((j) => j.id === job.id);
  assert.equal(saved.salaryMin, 230000);
  assert.equal(saved.status, "applied");
  assert.equal(saved.saved, true);
  assert.equal(saved.reason, "Personal note");
  assert.equal(state.profile, profile);
  assert.equal(state.jobs.find((j) => j.id === "missing").closed, true);
  assert.equal(state.jobs.find((j) => j.id === "stale").closed, undefined);
});
test("Apify uses only read-only requests, maps whitelisted public job fields, and never publishes token or task inputs", async () => {
  const calls = [];
  const secret = "fixture-not-a-real-token";
  const result = await collectApify(
    { APIFY_TOKEN: secret, APIFY_TASK_ID: "taskExample" },
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.includes("actor-tasks")
            ? {
                data: {
                  status: "SUCCEEDED",
                  defaultDatasetId: "datasetExample",
                },
              }
            : [
                {
                  title: "Principal Solutions Architect",
                  companyName: "Test Company",
                  location: "US",
                  url: "https://example.com/job",
                  description: "ERP architecture",
                  privateMetadata: "do not publish",
                  actorInput: { resume: "never publish" },
                },
              ],
      };
    },
  );
  assert.equal(result.jobs.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((c) => !c.options.method || c.options.method === "GET"),
  );
  assert.ok(
    calls.every(
      (c) =>
        !c.url.includes(secret) &&
        c.options.headers.Authorization === `Bearer ${secret}`,
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-not-a-real-token|do not publish|never publish|taskExample|datasetExample/,
  );
  assert.equal(result.jobs[0].salaryMin, 0);
  assert.equal((await collectApify({})).disabled, true);
  const missing = await collectApify({ APIFY_TASK_ID: "taskExample" });
  assert.match(missing.error, /APIFY_TOKEN/);
});

test("HarvestAPI documented output maps links, nested locations, annual base pay and seniority", async () => {
  const row = {
    id: "example",
    title: "Principal Enterprise Architect",
    linkedinUrl: "https://www.linkedin.com/jobs/view/example/",
    jobState: "LISTED",
    postedDate: "2026-10-25",
    location: { parsed: { text: "New York, NY, United States" } },
    company: {
      name: "Example Company",
      employeeCount: 75,
      industries: ["Enterprise Software"],
    },
    workplaceType: "hybrid",
    employmentType: "full_time",
    descriptionText: "Enterprise architecture and ERP",
    salary: {
      min: 210000,
      max: 260000,
      currency: "USD",
      payPeriod: "YEARLY",
      compensationType: "BASE_SALARY",
      text: "210,000–260,000 USD",
    },
  };
  const request = async () => ({
    ok: true,
    json: async () => [row, { ...row, id: "closed", closedAt: "2026-10-24" }],
  });
  const result = await collectApify(
    { APIFY_DATASET_IDS: "exampleDataset" },
    request,
  );
  assert.equal(result.jobs.length, 1);
  const j = result.jobs[0];
  assert.equal(j.salaryMin, 210000);
  assert.equal(j.currency, "USD");
  assert.equal(j.workMode, "Hybrid");
  assert.equal(j.seniority, "Principal");
  assert.equal(j.postedAt, "2026-10-25");
  assert.equal(j.teamSize, 75);
  assert.equal(j.location, "New York, NY, United States");
  assert.match(j.url, /linkedin.com/);
  const ote = await collectApify(
    { APIFY_DATASET_IDS: "exampleDataset" },
    async () => ({
      ok: true,
      json: async () => [
        {
          ...row,
          salary: { ...row.salary, compensationType: "TOTAL_COMPENSATION" },
        },
      ],
    }),
  );
  assert.equal(ote.jobs[0].salaryMin, 0);
});
