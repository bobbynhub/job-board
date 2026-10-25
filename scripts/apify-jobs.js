import { normalizeJob, safeUrl } from "../lib.js";
import { relevantTitle, plainText } from "./crawl-lib.js";
import { apifyApi, resolveApifyTask, successfulTaskRun } from "./apify-api.js";

const identifier = (value) => /^[a-zA-Z0-9_~.-]{1,120}$/.test(value);
export async function collectApify(env = process.env, request = fetch) {
  let task = env.APIFY_TASK_ID?.trim();
  const datasets = (env.APIFY_DATASET_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!task && !datasets.length && !env.APIFY_TOKEN)
    return {
      source: { provider: "apify", board: "configured", company: "Apify" },
      disabled: true,
    };
  const source = { provider: "apify", board: "configured", company: "Apify" };
  if (task && !env.APIFY_TOKEN)
    return {
      source,
      error: "A private saved task requires the APIFY_TOKEN repository secret.",
    };
  try {
    if (
      (task && !identifier(task)) ||
      datasets.some((d) => !identifier(d)) ||
      datasets.length > 10
    )
      throw new Error("Invalid Apify task or dataset configuration.");
    const get = apifyApi(env, request);
    task = task || (await resolveApifyTask(env, get));
    if (task) {
      // Read the last completed run. Task execution/scheduling stays in the user's Apify account.
      // No paid runs are started merely by enabling this repository's workflow.
      const run = await successfulTaskRun(task, get);
      if (
        run?.status !== "SUCCEEDED" ||
        !identifier(run?.defaultDatasetId || "")
      )
        throw new Error("No successful Apify task run is available yet.");
      datasets.push(run.defaultDatasetId);
    }
    const rows = [];
    for (const dataset of [...new Set(datasets)]) {
      let offset = 0;
      while (true) {
        const page = await get(
          `datasets/${encodeURIComponent(dataset)}/items?clean=true&offset=${offset}&limit=1000`,
        );
        if (!Array.isArray(page))
          throw new Error("Unsupported Apify dataset response.");
        rows.push(...page);
        if (page.length < 1000) break;
        offset += page.length;
        if (offset >= 5000)
          throw new Error(
            "Dataset is too large for this collector; narrow the saved task to fewer than 5,000 results.",
          );
      }
    }
    const jobs = [];
    let malformed = 0;
    for (const raw of rows) {
      if (raw.closedAt || (raw.jobState && raw.jobState !== "LISTED")) continue;
      const title = String(raw.title || raw.jobTitle || raw.positionName || "");
      if (!relevantTitle(title)) continue;
      const company =
        typeof raw.company === "string"
          ? raw.company
          : raw.company?.name || raw.companyName;
      const location =
        typeof raw.location === "string"
          ? raw.location
          : raw.location?.fullLocation ||
            raw.location?.parsed?.text ||
            raw.location?.linkedinText ||
            [raw.location?.city, raw.location?.state, raw.location?.country]
              .filter((x) => typeof x === "string")
              .join(", ");
      const url = safeUrl(
        raw.url ||
          raw.jobUrl ||
          raw.link ||
          raw.applyMethod?.companyApplyUrl ||
          raw.linkedinUrl,
      );
      if (!company || !url) {
        malformed++;
        continue;
      }
      const interval = String(
        raw.salaryInterval ||
          raw.salaryPeriod ||
          raw.salary?.interval ||
          raw.salary?.payPeriod ||
          "",
      ).toLowerCase();
      const annual =
        ["year", "yearly", "annual", "per-year"].includes(interval) &&
        (!raw.salary?.compensationType ||
          raw.salary.compensationType === "BASE_SALARY");
      const workplace = String(raw.workplaceType || "").toLowerCase();
      const level = /\bprincipal\b/i.test(title)
        ? "Principal"
        : /\blead\b/i.test(title)
          ? "Lead"
          : /\bstaff\b/i.test(title)
            ? "Staff"
            : /\b(senior|sr\.?)\b/i.test(title)
              ? "Senior"
              : "Unspecified";
      jobs.push({
        ...normalizeJob({
          ...raw,
          title,
          company,
          location,
          url,
          postedAt: raw.postedAt || raw.postedDate || raw.publishedAt,
          workMode:
            raw.workMode ||
            (raw.workRemoteAllowed === true || workplace === "remote"
              ? "Remote"
              : workplace === "hybrid"
                ? "Hybrid"
                : ["on_site", "onsite", "on-site", "office"].includes(workplace)
                  ? "On-site"
                  : "Unspecified"),
          seniority: raw.seniority || level,
          employment:
            raw.employment ||
            String(
              raw.employmentType || raw.contractType || "Unspecified",
            ).replaceAll("_", " "),
          teamSize: raw.teamSize || raw.company?.employeeCount,
          industry:
            raw.industry ||
            (Array.isArray(raw.company?.industries)
              ? raw.company.industries
                  .filter((x) => typeof x === "string")
                  .join(", ")
              : ""),
          description: plainText(
            raw.descriptionText || raw.description || raw.jobDescription,
          ).slice(0, 10000),
          salaryMin: annual ? raw.salaryMin || raw.salary?.min : 0,
          minSalary: 0,
          salaryMax: annual ? raw.salaryMax || raw.salary?.max : 0,
          currency: raw.currency || raw.salary?.currency || "USD",
          salaryText:
            typeof raw.salary === "string"
              ? raw.salary
              : raw.salaryText || raw.salaryInfo || raw.salary?.text || "",
          source: "Apify",
        }),
        feedSource: "apify:configured",
        externalId: String(raw.id || url),
        fromFeed: true,
      });
    }
    if (malformed)
      throw new Error(
        "Some relevant Apify results lack company names or application URLs. Map this actor’s schema before importing.",
      );
    return { source, jobs };
  } catch (error) {
    return { source, error: error.message };
  }
}
