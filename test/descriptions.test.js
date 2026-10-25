import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeJob, mergeJobs } from "../lib.js";
import { mapJobs } from "../scripts/crawl-lib.js";
import { postingUrl } from "../public/description.js";
import { syncFeed } from "../public/feed-sync.js";
test("rich source descriptions survive normalization and keep direct company application links", () => {
  const html =
    "<h3>Requirements</h3><ul><li>SQL</li><li>ERP integration</li></ul>";
  const job = normalizeJob({
    title: "Solutions Architect",
    company: "Example",
    descriptionHtml: html,
    url: "https://www.linkedin.com/jobs/view/123",
    applyMethod: { companyApplyUrl: "https://careers.example.com/jobs/123" },
  });
  assert.equal(job.descriptionHtml, html);
  assert.match(job.description, /SQL/);
  assert.equal(job.applicationUrl, "https://careers.example.com/jobs/123");
  assert.equal(postingUrl(job), "https://www.linkedin.com/jobs/view/123");
  assert.equal(
    postingUrl({ url: "https://jobs.lever.co/example/123/apply" }),
    "https://jobs.lever.co/example/123",
  );
  assert.equal(
    postingUrl({
      url: "https://www.linkedin.com/jobs/view/123",
      applicationUrl: "https://jobs.ashbyhq.com/example/abc/application",
    }),
    "https://jobs.ashbyhq.com/example/abc",
  );
  assert.equal(
    postingUrl({
      url: "https://boards.greenhouse.io/embed/job_app?for=example&token=123",
    }),
    "https://job-boards.greenhouse.io/example/jobs/123",
  );
  assert.equal(
    postingUrl({
      applicationUrl: "javascript:alert(1)",
      url: "https://example.com/job",
    }),
    "https://example.com/job",
  );
  assert.equal(postingUrl({ url: "javascript:alert(1)" }), "");
  const encoded = normalizeJob({
    title: "Solutions Architect",
    company: "Example",
    description:
      "&lt;p&gt;SQL&lt;/p&gt;&lt;ul&gt;&lt;li&gt;ERP&lt;/li&gt;&lt;/ul&gt;",
  });
  assert.match(encoded.descriptionHtml, /&lt;li&gt;/);
  assert.match(encoded.description, /ERP/);
});
test("Lever lists and Greenhouse encoded markup are retained with the main description", () => {
  const [lever] = mapJobs(
    { provider: "lever", board: "example", company: "Example" },
    [
      {
        text: "Solutions Engineer",
        hostedUrl: "https://example.com/1",
        applyUrl: "https://example.com/1/apply",
        description: "<p>Build systems.</p>",
        lists: [{ text: "Requirements", content: "<li>SQL</li><li>ERP</li>" }],
        additional: "<p>Benefits included.</p>",
      },
    ],
  );
  assert.match(lever.descriptionHtml, /<ul><li>SQL/);
  assert.match(lever.descriptionHtml, /Benefits included/);
  assert.equal(lever.applicationUrl, "https://example.com/1/apply");
  const [greenhouse] = mapJobs(
    { provider: "greenhouse", board: "example", company: "Example" },
    {
      jobs: [
        {
          title: "Enterprise Architect",
          absolute_url: "https://example.com/2",
          content:
            "&lt;p&gt;Hello&lt;/p&gt;&lt;ul&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;",
        },
      ],
    },
  );
  assert.match(greenhouse.descriptionHtml, /&lt;ul&gt;/);
});
test("reimport and feed refresh preserve collapse and application history while enriching descriptions", () => {
  const original = {
    ...normalizeJob({
      title: "Solutions Architect",
      company: "Example",
      location: "US",
      url: "https://example.com/job",
      description: "Old text",
    }),
    collapsed: true,
    status: "applied",
    saved: true,
    reason: "Private note",
  };
  const updated = {
    title: original.title,
    company: original.company,
    location: "US",
    url: original.url,
    descriptionHtml: "<ul><li>Updated detail</li></ul>",
  };
  const merged = mergeJobs([original], [updated]);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.added, 0);
  assert.equal(merged.jobs[0].collapsed, true);
  assert.equal(merged.jobs[0].status, "applied");
  assert.equal(merged.jobs[0].reason, "Private note");
  assert.match(merged.jobs[0].descriptionHtml, /Updated detail/);
  assert.equal(original.descriptionHtml, "");
  const state = { jobs: merged.jobs };
  syncFeed(state, {
    version: 1,
    generatedAt: "2026-10-25",
    sources: [{ id: "test", status: "ok" }],
    jobs: [{ ...normalizeJob(updated), feedSource: "test" }],
  });
  assert.equal(state.jobs[0].collapsed, true);
  assert.equal(state.jobs[0].saved, true);
  assert.equal(state.jobs[0].status, "applied");
});

test("the same source posting retains its local identity and collapse state after title and location edits", () => {
  const original = {
    ...normalizeJob({
      title: "Solutions Architect",
      company: "Example",
      location: "US",
      url: "https://example.com/job",
    }),
    fromFeed: true,
    feedSource: "greenhouse:example",
    externalId: "posting-123",
    collapsed: true,
    status: "applied",
    saved: true,
  };
  const incoming = {
    ...normalizeJob({
      title: "Senior Solutions Architect",
      company: "Example",
      location: "Remote, United States",
      url: "https://example.com/job",
    }),
    feedSource: original.feedSource,
    externalId: original.externalId,
    fromFeed: true,
  };
  assert.notEqual(incoming.id, original.id);
  const state = { jobs: [original] };
  const feed = {
    version: 1,
    generatedAt: "2026-10-25",
    jobs: [incoming],
    sources: [{ id: original.feedSource, status: "ok" }],
  };
  syncFeed(state, feed);
  syncFeed(state, feed);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].id, original.id);
  assert.equal(state.jobs[0].collapsed, true);
  assert.equal(state.jobs[0].closed, false);
  assert.equal(state.jobs[0].title, incoming.title);
  assert.equal(state.jobs[0].status, "applied");
});

test("repeated source updates preserve every reviewed state without creating a new local listing", () => {
  for (const status of ["feed", "applied", "discarded"]) {
    const old = {
      ...normalizeJob({
        title: "Enterprise Architect",
        company: "Example",
        location: "US",
        url: "https://example.com/job",
      }),
      feedSource: "greenhouse:example",
      externalId: "stable-123",
      fromFeed: true,
      collapsed: true,
      saved: true,
      status,
      reason: status === "discarded" ? "Not interested" : "",
    };
    const incoming = {
      ...normalizeJob({
        title: "Principal Enterprise Architect",
        company: "Example",
        location: "Remote, United States",
        url: "https://example.com/job",
        descriptionHtml: "<p>Updated content</p>",
      }),
      feedSource: old.feedSource,
      externalId: old.externalId,
    };
    const state = { jobs: [old] };
    const feed = {
      version: 1,
      generatedAt: "2026-10-25",
      jobs: [incoming],
      sources: [{ id: old.feedSource, status: "ok" }],
    };
    for (let n = 0; n < 3; n++) syncFeed(state, feed);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].status, status);
    assert.equal(state.jobs[0].collapsed, true);
    assert.equal(state.jobs[0].saved, true);
    assert.equal(state.jobs[0].reason, old.reason);
    assert.equal(state.jobs[0].id, old.id);
  }
});
