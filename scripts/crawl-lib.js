import { plainText } from "../public/description-text.js";
export { plainText } from "../public/description-text.js";
import { normalizeJob, safeUrl } from "../lib.js";

export const relevantTitle = (title) =>
  /\barchitect(?:ure)?\b|\bsolutions?\s+(?:engineer(?:ing)?|consultant)\b|\b(?:sales|pre.?sales)\s+engineer|\b(?:customer|partner|alliances|gtm|forward[ -]deployed)\s+(?:solutions?\s+)?engineer\b|\btechnical\s+(?:account\s+manager|consultant)\b|\b(?:head|director|lead)\b.*\b(?:business systems|enterprise applications|(?:enterprise\s+)?ai(?:\s+(?:strategy|transformation|solutions|practice|enablement))?)\b|\b(?:business systems|enterprise applications|(?:enterprise\s+)?ai(?:\s+(?:strategy|transformation|solutions|practice|enablement))?)\b.*\b(?:head|director|lead)\b/i.test(
    title,
  );
export function sourceUrl(source) {
  if (!/^[a-z0-9-]+$/i.test(source.board))
    throw new Error("Invalid board identifier.");
  if (source.provider === "greenhouse")
    return `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true`;
  if (source.provider === "lever")
    return `https://api.lever.co/v0/postings/${source.board}?mode=json`;
  if (source.provider === "ashby")
    return `https://api.ashbyhq.com/posting-api/job-board/${source.board}?includeCompensation=true`;
  throw new Error("Unsupported provider.");
}
const seniority = (title) =>
  /\bprincipal\b/i.test(title)
    ? "Principal"
    : /\blead\b/i.test(title)
      ? "Lead"
      : /\bstaff\b/i.test(title)
        ? "Staff"
        : /\b(senior|sr\.?)\b/i.test(title)
          ? "Senior"
          : /\bdirector\b/i.test(title)
            ? "Director"
            : "Unspecified";
export function mapJobs(source, payload) {
  const rows = source.provider === "lever" ? payload : payload.jobs;
  if (!Array.isArray(rows)) throw new Error("Unsupported provider response.");
  const result = [];
  for (const raw of rows) {
    if (raw.isListed === false) continue;
    const title = String(raw.title || raw.text || "").trim();
    if (!relevantTitle(title)) continue;
    const location =
      typeof raw.location === "string"
        ? raw.location
        : raw.location?.name || raw.categories?.location || "";
    const url = safeUrl(raw.absolute_url || raw.hostedUrl || raw.jobUrl);
    if (!url) continue;
    const escapeText = (text) =>
      String(text || "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    const sections =
      source.provider === "lever" && Array.isArray(raw.lists)
        ? raw.lists.map(
            (list) =>
              `<h3>${escapeText(list.text)}</h3><ul>${list.content || ""}</ul>`,
          )
        : [];
    const descriptionHtml = [
      raw.content ||
        raw.descriptionHtml ||
        raw.description ||
        raw.descriptionPlain ||
        "",
      ...sections,
      raw.additional || raw.additionalPlain || "",
    ]
      .filter(Boolean)
      .join("\n");
    const description = plainText(descriptionHtml);
    const range = raw.salaryRange;
    const annual =
      range &&
      ["per-year", "year", "yearly", "annual"].includes(
        String(range.interval).toLowerCase(),
      );
    const salaryMin =
      annual && Number.isFinite(range.min) ? Math.max(0, range.min) : 0;
    const salaryMax =
      annual && Number.isFinite(range.max) ? Math.max(0, range.max) : 0;
    const work = String(raw.workplaceType || "").toLowerCase();
    const workMode =
      raw.isRemote === true || work === "remote" || /\bremote\b/i.test(location)
        ? "Remote"
        : work === "hybrid" || /\bhybrid\b/i.test(location)
          ? "Hybrid"
          : ["on-site", "onsite", "on_site"].includes(work)
            ? "On-site"
            : "Unspecified";
    const payText =
      raw.compensation?.compensationTierSummary || raw.salaryDescription || "";
    const descriptionWithPay = payText
      ? `${description}\n\nCompensation\n${plainText(payText)}`
      : description;
    result.push({
      ...normalizeJob({
        title,
        company: source.company,
        location,
        description: descriptionWithPay.slice(0, 10000),
        descriptionHtml,
        applicationUrl: raw.applyUrl || url,
        url,
        source: `${source.company} · ${source.provider}`,
        workMode,
        seniority: seniority(title),
        employment:
          raw.employmentType || raw.categories?.commitment || "Unspecified",
        salaryMin,
        salaryMax,
        currency: range?.currency || "USD",
        salaryText: plainText(payText).slice(0, 400),
        postedAt:
          raw.publishedAt ||
          (raw.createdAt ? new Date(raw.createdAt).toISOString() : ""),
      }),
      feedSource: `${source.provider}:${source.board}`,
      externalId: String(raw.id || url),
      fromFeed: true,
    });
  }
  return result;
}

export function combineResults(
  results,
  previous = { jobs: [], sources: [] },
  now = new Date().toISOString(),
) {
  const jobs = new Map();
  const sources = [];
  let successes = 0;
  for (const result of results) {
    const id = `${result.source.provider}:${result.source.board}`;
    if (result.disabled) {
      sources.push({
        id,
        company: result.source.company,
        status: "not-configured",
        count: 0,
        checkedAt: now,
      });
      continue;
    }
    if (result.jobs) {
      successes++;
      sources.push({
        id,
        company: result.source.company,
        status: "ok",
        count: result.jobs.length,
        checkedAt: now,
      });
      for (const job of result.jobs) jobs.set(job.id, job);
    } else {
      const old = previous.sources?.find((s) => s.id === id);
      const retained = (previous.jobs || []).filter((j) => j.feedSource === id);
      for (const job of retained) jobs.set(job.id, job);
      sources.push({
        id,
        company: result.source.company,
        status: retained.length ? "stale" : "unavailable",
        count: retained.length,
        checkedAt: now,
        lastSuccessAt:
          old?.lastSuccessAt ||
          (old?.status === "ok" ? old.checkedAt : undefined),
        error: result.error,
      });
    }
  }
  if (!successes)
    throw new Error(
      "All career sources failed; keeping the previously deployed site.",
    );
  return { version: 1, generatedAt: now, jobs: [...jobs.values()], sources };
}
