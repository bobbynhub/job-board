import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeJob, mergeJobs, safeUrl } from "../lib.js";
import { assess, roleMatches, seniorityMatches } from "../public/matching.js";

const dir = mkdtempSync(path.join(tmpdir(), "shortlist-test-"));
process.env.DATA_DIR = dir;
const { server } = await import("../server.js");
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});
const request = async (url, method = "GET", data) => {
  const response = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
};

test("job aliases, unsafe links, and normalized duplicate detection", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  const first = normalizeJob({
    jobTitle: "Senior Solutions Architect",
    companyName: "Acme",
    location: "US",
    jobUrl: "https://example.com/job",
  });
  const result = mergeJobs(
    [first],
    [
      {
        title: "Senior Solutions Architect",
        company: "ACME",
        location: "US",
        url: "https://another.example/job",
      },
    ],
  );
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
  assert.throws(() => mergeJobs([first], [{ company: "Missing title" }]));
  assert.equal(first.status, "feed");
});
test("architecture role aliases and seniority use word boundaries", () => {
  assert.equal(
    roleMatches("Principal Solution Architect", ["Solutions Architecture"]),
    true,
  );
  assert.equal(
    roleMatches("Lead Solutions Engineer", ["Solutions Engineering"]),
    true,
  );
  assert.equal(
    roleMatches("Senior Frontend Engineer", ["Enterprise Architecture"]),
    false,
  );
  assert.equal(
    seniorityMatches({ title: "Sr. Enterprise Architect", seniority: "" }, [
      "Senior",
    ]),
    true,
  );
  assert.equal(
    seniorityMatches({ title: "Sales Representative", seniority: "" }, [
      "Lead",
    ]),
    false,
  );
});
test("fit explains skills, remote preference, salary floor, overlap and unknown currencies", () => {
  const p = {
    skills: ["SQL", "Azure", "C++"],
    roles: ["Solutions Architect"],
    seniorities: ["Principal"],
    workMode: "Remote",
    salaryMin: 200000,
    currency: "USD",
    years: "20",
  };
  const job = normalizeJob({
    title: "Principal Solutions Architect",
    company: "Test",
    description: "SQL and Azure integration with C++",
    workMode: "Remote",
    salaryMin: 210000,
    salaryMax: 240000,
  });
  const fit = assess(job, p);
  assert.equal(fit.score, 100);
  assert.equal(fit.salary, "meets");
  assert.equal(fit.matched.length, 3);
  assert.equal(
    assess({ ...job, salaryMin: 180000, salaryMax: 220000 }, p).salary,
    "overlap",
  );
  assert.equal(
    assess({ ...job, salaryMin: 180000, salaryMax: 190000 }, p).salary,
    "below",
  );
  assert.equal(assess({ ...job, currency: "CAD" }, p).salary, "unknown");
  assert.equal(assess({ ...job, salaryMin: 0 }, p).salary, "unknown");
  assert.deepEqual(
    assess({ ...job, description: "MySQL and Java" }, { ...p, skills: ["SQL"] })
      .matched,
    [],
  );
  assert.equal(assess(job, {}).score, null);
  assert.match(
    assess({ ...job, minExperience: 25 }, p).warnings.join(" "),
    /Requires 25/,
  );
  assert.equal(seniorityMatches(job, ["(Principal"]), false);
});
test("HTTP workflow: profile, import, dedupe, save, apply, discard, restore, research notes, persistence", async () => {
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /shortlist/);
  assert.equal(
    html.headers.get("content-security-policy").includes("script-src 'self'"),
    true,
  );
  const profile = {
    roles: ["Enterprise Architect"],
    skills: ["SQL", "Governance"],
    seniorities: ["Senior", "Principal"],
    strictRole: true,
    salaryMin: 200000,
    currency: "USD",
    years: "20",
    workMode: "Remote",
    location: "",
  };
  assert.equal((await request("/api/profile", "PUT", profile)).status, 200);
  const jobs = [
    {
      title: "Principal Enterprise Architect",
      company: "Test Company",
      location: "US",
      salaryMin: 220000,
      url: "https://example.com",
    },
  ];
  assert.equal((await request("/api/import", "POST", { jobs })).body.added, 1);
  assert.equal(
    (await request("/api/import", "POST", { jobs })).body.duplicates,
    1,
  );
  const job = (await request("/api/board")).body.jobs.find(
    (j) => j.company === "Test Company",
  );
  assert.equal(
    (
      await request("/api/jobs/" + job.id, "PATCH", {
        saved: true,
        status: "applied",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/jobs/" + job.id, "PATCH", { status: "discarded" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("/api/jobs/" + job.id, "PATCH", {
        status: "discarded",
        reason: "Company values",
        excludeCompany: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/company", "PUT", {
        company: "Test Company",
        notes: "Source reviewed",
        source: "https://example.com/about",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/preferences", "PUT", {
        excludedCompanies: [],
        excludedKeywords: ["unpaid"],
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/jobs/" + job.id, "PATCH", { status: "feed" })).status,
    200,
  );
  const disk = JSON.parse(readFileSync(path.join(dir, "board.json"), "utf8"));
  assert.equal(disk.profile.salaryMin, 200000);
  assert.equal(disk.profile.strictRole, true);
  assert.equal(disk.jobs.find((j) => j.id === job.id).saved, true);
  assert.equal(disk.jobs.find((j) => j.id === job.id).status, "feed");
  assert.equal(disk.companies["Test Company"].notes, "Source reviewed");
  assert.equal((await request("/api/demo", "DELETE")).status, 200);
  assert.equal((await request("/api/board")).body.jobs.length, 1);
});
test("invalid imports are atomic and cross-origin writes are rejected", async () => {
  const before = (await request("/api/board")).body.jobs.length;
  assert.equal(
    (
      await request("/api/import", "POST", {
        jobs: [{ title: "Valid", company: "A" }, {}],
      })
    ).status,
    400,
  );
  assert.equal((await request("/api/board")).body.jobs.length, before);
  const response = await fetch(base + "/api/demo", {
    method: "DELETE",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await request("/api/import", "POST", { datasetId: "../../secret" }))
      .status,
    400,
  );
});
