import { plainText, hasDescriptionHtml } from "./description-text.js";
import { inferCompensation } from "./compensation.js";
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
export function normalizeFields(raw) {
  const title = str(raw.title || raw.positionName || raw.jobTitle);
  const company = str(
    typeof raw.company === "object"
      ? raw.company?.name
      : raw.company || raw.companyName,
  );
  if (!title || !company)
    throw new Error("Each job needs a title and company.");
  const url = safeUrl(raw.url || raw.jobUrl || raw.link);
  const salary = Number(raw.salaryMin || raw.minSalary || 0);
  const provided = str(
    raw.description || raw.descriptionText || raw.jobDescription,
  );
  const candidate =
    typeof (
      raw.descriptionHtml ||
      raw.descriptionHTML ||
      raw.htmlDescription
    ) === "string"
      ? (raw.descriptionHtml || raw.descriptionHTML || raw.htmlDescription)
          .trim()
          .slice(0, 50000)
      : provided;
  const descriptionHtml = hasDescriptionHtml(candidate)
    ? candidate
    : hasDescriptionHtml(provided)
      ? provided
      : "";
  const fullText = descriptionHtml
    ? plainText(descriptionHtml)
    : provided || candidate;
  const inferred = inferCompensation(
    `${fullText}\n${raw.salaryText ? "Compensation\n" + str(raw.salaryText) : ""}`,
    str(raw.location),
  );
  const structured = Number.isFinite(salary) && salary > 0;
  const maximum = Number(raw.salaryMax || 0);
  return {
    title,
    company,
    location: str(raw.location) || "Not specified",
    url,
    applicationUrl:
      safeUrl(
        raw.applicationUrl || raw.applyUrl || raw.applyMethod?.companyApplyUrl,
      ) || url,
    description: descriptionHtml
      ? plainText(provided || descriptionHtml).slice(0, 20000)
      : provided || candidate,
    descriptionHtml,
    source: str(raw.source || raw.platform) || "Import",
    workMode:
      str(raw.workMode || (raw.isRemote ? "Remote" : "")) || "Unspecified",
    seniority: str(raw.seniority || raw.experienceLevel) || "Unspecified",
    employment: str(raw.employment || raw.contractType) || "Unspecified",
    salaryMin: structured ? salary : inferred.salaryMin,
    salaryMax: structured
      ? Number.isFinite(maximum)
        ? Math.max(0, maximum)
        : 0
      : inferred.salaryMax,
    currency: structured
      ? str(raw.currency) || "USD"
      : inferred.currency || str(raw.currency) || "USD",
    salaryText: str(raw.salaryText),
    salarySummary: structured ? "" : inferred.summary,
    salaryKind: structured ? "annual-base" : inferred.kind,
    salaryMentioned:
      structured || inferred.mentioned || Boolean(str(raw.salaryText)),
    salaryEvidence: structured
      ? raw.salaryEvidence || "structured"
      : inferred.salaryMin
        ? "description"
        : "unverified",
    salaryMultipleRanges: structured
      ? Boolean(raw.salaryMultipleRanges)
      : Boolean(inferred.multipleRanges),
    minExperience: Math.max(0, Number(raw.minExperience) || 0),
    postedAt: str(raw.postedAt || raw.postedTime || raw.publishedAt),
    teamSize: Math.max(0, Number(raw.teamSize) || 0),
    industry: str(raw.industry),
    sponsorship: str(raw.sponsorship) || "Unknown",
    status: "feed",
    saved: false,
    collapsed: false,
    reason: "",
    demo: Boolean(raw.demo),
  };
}

export function jobKey(raw) {
  const j = normalizeFields(raw);
  return `${j.company}|${j.title}|${str(raw.location)}`
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "");
}
