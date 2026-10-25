import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyGroups,
  setCompanyCollapsed,
} from "../public/company-collapse.js";
import { normalizeJob } from "../lib.js";
import { syncFeed } from "../public/feed-sync.js";
test("company collapse matches normalized names across statuses and never changes review decisions", () => {
  const jobs = [
    { company: "Acme", status: "applied", saved: true, reason: "" },
    {
      company: " ACME ",
      status: "discarded",
      saved: false,
      reason: "Not a fit",
    },
    { company: "Other", status: "feed", collapsed: false },
  ];
  const state = { jobs };
  const before = jobs.map((j) => ({
    status: j.status,
    saved: j.saved,
    reason: j.reason,
  }));
  assert.equal(setCompanyCollapsed(state, "acme", true).updated, 2);
  assert.equal(jobs[0].collapsed, true);
  assert.equal(jobs[1].collapsed, true);
  assert.equal(jobs[2].collapsed, false);
  assert.deepEqual(
    jobs.map((j) => ({ status: j.status, saved: j.saved, reason: j.reason })),
    before,
  );
  assert.deepEqual(companyGroups(jobs).get("acme"), { total: 2, collapsed: 2 });
  setCompanyCollapsed(state, "Acme", false);
  assert.equal(jobs[0].collapsed, false);
  assert.equal(jobs[1].collapsed, false);
  assert.throws(
    () => setCompanyCollapsed(state, "Missing", true),
    /No listings/,
  );
  assert.throws(
    () => setCompanyCollapsed(state, "Acme", "yes"),
    /collapse state/,
  );
});
test("company collapsed rows survive source refresh but genuinely new company postings remain open", () => {
  const original = {
    ...normalizeJob({
      title: "Architect",
      company: "Acme",
      url: "https://example.com/a",
    }),
    fromFeed: true,
    feedSource: "greenhouse:acme",
    externalId: "a",
    status: "applied",
  };
  const state = { jobs: [original] };
  setCompanyCollapsed(state, "Acme", true);
  const incoming = {
    ...normalizeJob({
      title: "Senior Architect",
      company: "Acme",
      url: "https://example.com/a",
    }),
    feedSource: original.feedSource,
    externalId: "a",
  };
  const fresh = {
    ...normalizeJob({
      title: "Solutions Engineer",
      company: "Acme",
      url: "https://example.com/b",
    }),
    feedSource: original.feedSource,
    externalId: "b",
  };
  syncFeed(state, {
    version: 1,
    generatedAt: "2026-10-25",
    sources: [{ id: original.feedSource, status: "ok" }],
    jobs: [incoming, fresh],
  });
  assert.equal(state.jobs.find((j) => j.id === original.id).collapsed, true);
  assert.equal(state.jobs.find((j) => j.externalId === "a").status, "applied");
  assert.equal(state.jobs.find((j) => j.externalId === "b").collapsed, false);
});
