import { createHash } from "node:crypto";

import { normalizeFields, jobKey } from "./public/jobs.js";
export { safeUrl } from "./public/jobs.js";
export function normalizeJob(raw) {
  return {
    id: createHash("sha256").update(jobKey(raw)).digest("hex").slice(0, 20),
    ...normalizeFields(raw),
  };
}
export function mergeJobs(existing, input) {
  if (!Array.isArray(input) || input.length > 5000)
    throw new Error("Import an array of up to 5,000 jobs.");
  const jobs = [...existing];
  const ids = new Set(jobs.map((j) => j.id));
  let duplicates = 0;
  const normalized = input.map(normalizeJob);
  for (const job of normalized) {
    if (ids.has(job.id)) {
      duplicates++;
      continue;
    }
    ids.add(job.id);
    jobs.push(job);
  }
  return { jobs, added: jobs.length - existing.length, duplicates };
}
