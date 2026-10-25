import { test } from "node:test";
import assert from "node:assert/strict";
import { inferCompensation, salaryLine } from "../public/compensation.js";
import { normalizeJob } from "../lib.js";
import { assess } from "../public/matching.js";
test("clear annual base ranges in descriptions become searchable salary data with currency", () => {
  const salary = inferCompensation(
    "Annual base salary is $210,000–$260,000 per year.",
    "United States",
  );
  assert.equal(salary.salaryMin, 210000);
  assert.equal(salary.salaryMax, 260000);
  assert.equal(salary.currency, "USD");
  const job = normalizeJob({
    title: "Architect",
    company: "Acme",
    location: "New York, NY",
    descriptionHtml: "<h3>Pay</h3><p>Annual base salary is $210k-$260k.</p>",
  });
  assert.equal(job.salaryMin, 210000);
  assert.equal(job.salaryEvidence, "description");
  assert.equal(
    assess(job, { salaryMin: 200000, currency: "USD" }).salary,
    "meets",
  );
  const cad = inferCompensation(
    "Base salary CAD 200,000 - CAD 250,000 per year.",
    "Canada",
  );
  assert.equal(cad.currency, "CAD");
  assert.equal(cad.salaryMin, 200000);
});
test("dollar-line fallback requires a number and prefers pay language over company metrics", () => {
  assert.equal(
    salaryLine(
      "We manage $19B in assets under management.\nSalary starts at $220,000 per year.",
    ),
    "Salary starts at $220,000 per year.",
  );
  assert.equal(salaryLine("We manage $19B in assets under management."), "");
  assert.equal(salaryLine("The $ symbol appears here."), "");
  const single = inferCompensation("Salary starts at $220,000 per year.", "US");
  assert.match(single.summary, /\$220,000/);
});
test("hourly, monthly, OTE and unconfirmed pay periods are displayed without becoming annual base salary", () => {
  for (const text of [
    "Hourly pay: $70 - $90 per hour.",
    "Base salary: $8,000 - $10,000 per month.",
    "OTE is $250,000 - $300,000 per year.",
    "Base salary range: $180,000 - $220,000.",
  ]) {
    const salary = inferCompensation(text, "US");
    assert.equal(salary.salaryMin, 0, text);
    assert.match(salary.summary, /\$\d/);
    assert.equal(salary.mentioned, true);
    const job = normalizeJob({
      title: "Architect",
      company: "Acme",
      location: "US",
      description: text,
    });
    assert.equal(job.salaryMin, 0);
    assert.doesNotMatch(
      assess(job, { salaryMin: 200000, currency: "USD" }).warnings.join(" "),
      /undisclosed/,
    );
  }
});
test("benefits and business amounts do not contaminate base ranges; unknown currency stays unverified", () => {
  const salary = inferCompensation(
    "Annual base salary is $200k - $250k. An annual learning budget of $1,000 - $2,000 is also available.",
    "US",
  );
  assert.equal(salary.salaryMin, 200000);
  assert.equal(salary.salaryMax, 250000);
  assert.equal(
    inferCompensation("Annual base salary $200k-$250k.", "Remote").salaryMin,
    0,
  );
  assert.equal(
    inferCompensation(
      "Base salary $200k-$250k with an annual learning budget.",
      "US",
    ).salaryMin,
    0,
  );
});
test("multiple annual base ranges in one currency show the full envelope without guaranteeing the upper range", () => {
  const salary = inferCompensation(
    "Annual base salary for New York: $210k-$260k per year.\nAnnual base salary for other US areas: $180k-$230k per year.",
    "US",
  );
  assert.equal(salary.salaryMin, 180000);
  assert.equal(salary.salaryMax, 260000);
  assert.equal(salary.multipleRanges, true);
});

test("encoded currency and dash entities are decoded before salary-line extraction", () => {
  const job = normalizeJob({
    title: "Architect",
    company: "Acme",
    location: "US",
    descriptionHtml:
      "&lt;p&gt;Annual Salary:&lt;/p&gt;&lt;p&gt;&dollar;210,000 &mdash; &dollar;260,000 USD&lt;/p&gt;",
  });
  assert.equal(job.salaryMin, 210000);
  assert.equal(job.salaryMax, 260000);
  assert.doesNotMatch(job.description, /&mdash;|&dollar;|&lt;/);
  const uncertain = normalizeJob({
    title: "Solutions Architect",
    company: "Acme",
    location: "US",
    descriptionHtml:
      "<p>For sales roles, the range includes sales commissions and annual base salary.</p><p>Annual Salary:</p><p>$210,000 &mdash; $260,000 USD</p>",
  });
  assert.equal(uncertain.salaryMin, 0);
  assert.match(uncertain.salarySummary, /\$210,000/);
  assert.doesNotMatch(uncertain.salarySummary, /&mdash;/);
});
