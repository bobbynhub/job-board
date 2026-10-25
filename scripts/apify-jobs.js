import { normalizeJob, safeUrl } from "../lib.js";
import { relevantTitle, plainText } from "./crawl-lib.js";

const identifier = (value) => /^[a-zA-Z0-9_~.-]{1,120}$/.test(value);
export async function collectApify(env = process.env, request = fetch) {
  const task = env.APIFY_TASK_ID?.trim();
  const datasets = (env.APIFY_DATASET_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!task && !datasets.length)
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
    async function get(route) {
      let response;
      try {
        response = await request("https://api.apify.com/v2/" + route, {
          headers: env.APIFY_TOKEN
            ? { Authorization: `Bearer ${env.APIFY_TOKEN}` }
            : {},
          signal: AbortSignal.timeout(25000),
          redirect: "error",
        });
      } catch {
        throw new Error("Could not reach the Apify API.");
      }
      if (!response.ok)
        throw new Error(
          `Apify API returned HTTP ${response.status}. Check repository configuration.`,
        );
      return response.json();
    }
    if (task) {
      // Read the last completed run. Task execution/scheduling stays in the user's Apify account.
      // No paid runs are started merely by enabling this repository's workflow.
      const result = await get(
        `actor-tasks/${encodeURIComponent(task)}/runs/last?status=SUCCEEDED`,
      );
      if (
        result.data?.status !== "SUCCEEDED" ||
        !identifier(result.data?.defaultDatasetId || "")
      )
        throw new Error("No successful Apify task run is available yet.");
      datasets.push(result.data.defaultDatasetId);
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
            [raw.location?.city, raw.location?.state, raw.location?.country]
              .filter((x) => typeof x === "string")
              .join(", ");
      const url = safeUrl(raw.url || raw.jobUrl || raw.link);
      if (!company || !url) {
        malformed++;
        continue;
      }
      const interval = String(
        raw.salaryInterval || raw.salaryPeriod || raw.salary?.interval || "",
      ).toLowerCase();
      const annual = ["year", "yearly", "annual", "per-year"].includes(
        interval,
      );
      jobs.push({
        ...normalizeJob({
          ...raw,
          title,
          company,
          location,
          url,
          description: plainText(
            raw.descriptionText || raw.description || raw.jobDescription,
          ).slice(0, 10000),
          salaryMin: annual ? raw.salaryMin || raw.salary?.min : 0,
          minSalary: 0,
          salaryMax: annual ? raw.salaryMax || raw.salary?.max : 0,
          salaryText:
            typeof raw.salary === "string"
              ? raw.salary
              : raw.salaryText || raw.salaryInfo || "",
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
