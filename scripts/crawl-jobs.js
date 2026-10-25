import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sourceUrl, mapJobs, combineResults } from "./crawl-lib.js";
import { collectApify } from "./apify-jobs.js";
http.setGlobalProxyFromEnv();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(
  readFileSync(path.join(root, "config/job-sources.json"), "utf8"),
);
const output = path.join(root, "public/jobs-feed.json");
let previous = { jobs: [], sources: [] };
try {
  previous = JSON.parse(readFileSync(output, "utf8"));
} catch {
  // Reuse public data from the last deployment when a source is temporarily down.
  try {
    const r = await fetch(
      "https://bobbynhub.github.io/job-board/jobs-feed.json",
      { signal: AbortSignal.timeout(15000) },
    );
    if (r.ok) previous = await r.json();
  } catch {
    /* The first crawl has no previous feed. */
  }
}
let index = 0;
const results = [];
async function worker() {
  while (index < sources.length) {
    const source = sources[index++];
    try {
      const response = await fetch(sourceUrl(source), {
        headers: {
          "User-Agent": "ShortlistJobBoard/1.0 (public career feed collection)",
        },
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const jobs = mapJobs(source, await response.json());
      results.push({ source, jobs });
      console.log(`${source.company}: ${jobs.length} relevant public openings`);
    } catch (error) {
      const message =
        error.message === "fetch failed"
          ? "Network request failed"
          : error.message;
      results.push({ source, error: message });
      console.warn(`${source.company}: ${message}`);
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
const apify = await collectApify();
results.push(apify);
console.log(
  apify.disabled
    ? "Apify: not configured (public career feeds still run)"
    : apify.error
      ? `Apify: ${apify.error}`
      : `Apify: ${apify.jobs.length} relevant listings imported`,
);
const feed = combineResults(results, previous);
feed.sources.sort((a, b) => a.company.localeCompare(b.company));
feed.jobs.sort(
  (a, b) =>
    a.company.localeCompare(b.company) || a.title.localeCompare(b.title),
);
writeFileSync(output, JSON.stringify(feed));
console.log(
  `Collected ${feed.jobs.length} listings; ${feed.sources.filter((s) => s.status === "ok").length}/${sources.length} sources succeeded. No personal profiles or preferences were read.`,
);
