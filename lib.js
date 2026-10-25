import { createHash } from "node:crypto";

export function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
const str = (value) =>
  typeof value === "string" ? value.trim().slice(0, 20000) : "";
export function normalizeJob(raw) {
  const title = str(raw.title || raw.positionName || raw.jobTitle);
  const company = str(
    typeof raw.company === "object"
      ? raw.company?.name
      : raw.company || raw.companyName,
  );
  if (!title || !company)
    throw new Error("Each job needs a title and company.");
  const url = safeUrl(raw.url || raw.jobUrl || raw.link);
  const key = `${company}|${title}|${str(raw.location)}`
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "");
  const salary = Number(raw.salaryMin || raw.minSalary || 0);
  return {
    id: createHash("sha256").update(key).digest("hex").slice(0, 20),
    title,
    company,
    location: str(raw.location) || "Not specified",
    url,
    description: str(
      raw.description || raw.descriptionText || raw.jobDescription,
    ),
    source: str(raw.source || raw.platform) || "Import",
    workMode:
      str(raw.workMode || (raw.isRemote ? "Remote" : "")) || "Unspecified",
    seniority: str(raw.seniority || raw.experienceLevel) || "Unspecified",
    employment: str(raw.employment || raw.contractType) || "Unspecified",
    salaryMin: Number.isFinite(salary) && salary >= 0 ? salary : 0,
    salaryMax: Math.max(0, Number(raw.salaryMax) || 0),
    currency: str(raw.currency) || "USD",
    salaryText: str(raw.salaryText),
    minExperience: Math.max(0, Number(raw.minExperience) || 0),
    postedAt: str(raw.postedAt || raw.postedTime || raw.publishedAt),
    teamSize: Math.max(0, Number(raw.teamSize) || 0),
    industry: str(raw.industry),
    sponsorship: str(raw.sponsorship) || "Unknown",
    status: "feed",
    saved: false,
    reason: "",
    demo: Boolean(raw.demo),
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
