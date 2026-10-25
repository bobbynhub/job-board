import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { normalizeJob } from "../lib.js";
import { browserApi } from "../public/browser-api.js";

test("Pages artifact contains only public code and no server or private data", () => {
  execFileSync(process.execPath, ["scripts/build-pages.js"]);
  assert.deepEqual(
    readdirSync("dist").sort(),
    [
      ".nojekyll",
      "app.js",
      "browser-api.js",
      "demo.js",
      "feed-sync.js",
      ...(existsSync("public/jobs-feed.json") ? ["jobs-feed.json"] : []),
      "index.html",
      "jobs.js",
      "matching.js",
      "style.css",
    ].sort(),
  );
  const html = readFileSync("dist/index.html", "utf8");
  assert.match(html, /name="shortlist-mode" content="browser"/);
  assert.match(html, /src="\.\/app.js"/);
  assert.match(html, /href="\.\/style.css"/);
  assert.doesNotMatch(html, /src="\/app.js"/);
});

test("browser storage keeps profiles, imports, actions and preferences local without backend calls", async () => {
  const storage = new Map();
  globalThis.location = {
    pathname: "/job-board/",
    origin: "https://bobbynhub.github.io",
  };
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests++;
    throw new Error("Unexpected network request");
  };
  try {
    assert.equal((await browserApi("/api/board")).jobs.length, 8);
    const profile = {
      skills: ["SQL", "ERP"],
      roles: ["Enterprise Architect"],
      seniorities: ["Principal"],
      strictRole: true,
      years: "20",
      salaryMin: 200000,
      currency: "USD",
      workMode: "Remote",
    };
    await browserApi("/api/profile", "PUT", profile);
    assert.equal((await browserApi("/api/board")).profile.salaryMin, 200000);
    const raw = {
      title: "Principal Enterprise Architect",
      company: "Private Test",
      location: "US",
    };
    assert.equal(
      (await browserApi("/api/import", "POST", { jobs: [raw] })).added,
      1,
    );
    assert.equal(
      (await browserApi("/api/import", "POST", { jobs: [raw] })).duplicates,
      1,
    );
    const job = (await browserApi("/api/board")).jobs.find(
      (j) => j.company === "Private Test",
    );
    assert.equal(job.id, normalizeJob(raw).id);
    await browserApi("/api/jobs/" + job.id, "PATCH", {
      saved: true,
      status: "applied",
    });
    await assert.rejects(
      () => browserApi("/api/jobs/" + job.id, "PATCH", { status: "discarded" }),
      /reason/,
    );
    await browserApi("/api/jobs/" + job.id, "PATCH", {
      status: "discarded",
      reason: "Not interested",
      excludeCompany: true,
    });
    const board = await browserApi("/api/board");
    assert.equal(board.jobs.find((j) => j.id === job.id).saved, true);
    assert.deepEqual(board.excludedCompanies, ["Private Test"]);
    assert.equal(networkRequests, 0);
    const before = board.jobs.length;
    await assert.rejects(() =>
      browserApi("/api/import", "POST", { jobs: [raw, {}] }),
    );
    assert.equal((await browserApi("/api/board")).jobs.length, before);
    // Another repository on the same host gets a distinct application storage key.
    location.pathname = "/another-board/";
    assert.equal((await browserApi("/api/board")).profile.salaryMin, 0);
    location.pathname = "/job-board/";
    assert.equal((await browserApi("/api/board")).profile.salaryMin, 200000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
