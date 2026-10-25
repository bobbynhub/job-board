import { jobGeography } from "./geography.js";

const moneyToken = String.raw`(?:US\$|U\.S\.\$|CA\$|C\$|USD\s*\$?|CAD\s*\$?|AUD\s*\$?|GBP\s*£?|EUR\s*€?|\$|£|€)`;
const amount = String.raw`(?:\d{1,3}(?:,\d{3}){1,3}(?:\.\d{1,2})?|\d{1,9}(?:\.\d{1,2})?)`;
const currencyOf = (value) => {
  const text = String(value || "")
    .toUpperCase()
    .replace(/\s/g, "");
  if (/USD|US\$|U\.S\.\$/.test(text)) return "USD";
  if (/CAD|CA\$|C\$/.test(text)) return "CAD";
  if (/AUD/.test(text)) return "AUD";
  if (/GBP|£/.test(text)) return "GBP";
  if (/EUR|€/.test(text)) return "EUR";
  return "";
};
export function salaryLine(text) {
  const candidates = [];
  for (const line of String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    for (const match of line.matchAll(
      /(?:US\$|CA\$|C\$|\$)\s*\d[\d,.]*[kKmM]?/g,
    )) {
      const context = line.slice(
        Math.max(0, match.index - 100),
        match.index + 140,
      );
      let score = /\bbase (?:salary|pay)\b/i.test(context)
        ? 12
        : /\bsalar(?:y|ies)\b/i.test(context)
          ? 10
          : /\b(?:compensation|pay range|pay rate|wage|OTE|earnings)\b/i.test(
                context,
              )
            ? 7
            : 0;
      if (
        /\b(?:revenue|valuation|assets under management|AUM|funding|raised|market cap)\b/i.test(
          context,
        ) &&
        score === 0
      )
        continue;
      if (
        /\b(?:budget|allowance|stipend|reimbursement|bonus|equity|stock)\b/i.test(
          context,
        ) &&
        score < 10
      )
        score -= 3;
      let snippet = line;
      if (snippet.length > 220) {
        const start = Math.max(0, match.index - 60),
          end = Math.min(line.length, match.index + 150);
        snippet =
          (start ? "…" : "") +
          line.slice(start, end) +
          (end < line.length ? "…" : "");
      }
      candidates.push({ score, text: snippet });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.text || "";
}
function briefRange(match, currency) {
  const raw = match[0].trim().replace(/\s+/g, " ");
  return (
    raw +
    (currency && !new RegExp(currency, "i").test(raw) ? ` ${currency}` : "")
  );
}
export function inferCompensation(text, location = "") {
  text = String(text || "").replace(/\u00a0/g, " ");
  const mentioned =
    /\b(?:salary|salaries|compensation|base pay|base range|on[- ]target earnings|OTE|pay range|pay rate)\b/i.test(
      text,
    );
  const expression = new RegExp(
    String.raw`(?<![\d.,])(?<prefix1>${moneyToken})?\s{0,8}(?<min>${amount})\s{0,8}(?<unit1>[kK])?\s{0,8}(?:-|–|—|−|to|and)\s{0,8}(?<prefix2>${moneyToken})?\s{0,8}(?<max>${amount})\s{0,8}(?<unit2>[kK])?(?:\s{0,8}(?<suffix>USD|CAD|AUD|GBP|EUR))?(?!\d|,\d|\.\d)`,
    "gi",
  );
  const candidates = [];
  for (const match of text.matchAll(expression)) {
    const g = match.groups;
    if (!g.prefix1 && !g.prefix2 && !g.suffix) continue;
    const start = match.index,
      end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 180), start),
      after = text.slice(end, end + 100);
    if (/^\s*%/.test(after)) continue;
    const labels = [
      ...before.matchAll(
        /\b(?:base(?: annual)? (?:salary|pay|compensation)|base range|on[- ]target earnings|OTE|total (?:cash )?compensation|salary|salaries|compensation|pay range|pay rate|commission|budget|allowance|reimbursement|stipend|sign[- ]on bonus|signing bonus|bonus|equity|stock|relocation)\b/gi,
      ),
    ];
    let label = labels.at(-1)?.[0] || "";
    const trailing =
      /^\s*[,;(]?\s*(OTE|on[- ]target earnings|total compensation|base salary|salary)\b/i.exec(
        after,
      );
    if (trailing) label = trailing[1];
    const context = before + match[0] + after;
    const hourly =
      /^(?:\s|\)|,)*(?:\/\s*(?:hr|hour)|per\s+hour|an?\s+hour|hourly)\b/i.test(
        after,
      ) || /\bhourly\s+(?:base\s+)?(?:salary|pay|rate)\b[^.\n]*$/i.test(before);
    const monthly =
      /^(?:\s|\)|,)*(?:\/\s*(?:mo|month)|per\s+month|a\s+month|monthly)\b/i.test(
        after,
      );
    const otherPeriod =
      /^(?:\s|\)|,)*(?:\/\s*(?:day|week)|per\s+(?:day|week)|(?:daily|weekly))\b/i.test(
        after,
      );
    const annual =
      /\b(?:annual|yearly)\s+(?:base\s+)?(?:salary|pay|range|compensation)\b[^.\n]{0,90}\s{0,10}$/i.test(
        before,
      ) ||
      /\b(?:salary|pay|compensation|range)\b[^.\n]{0,35}\b(?:annually|yearly|per year)\b[^.\n]{0,40}\s{0,10}$/i.test(
        before,
      ) ||
      /^\s*[,;()]*\s*(?:\/\s*(?:year|yr)|(?:per|a|each)\s+year|annually|yearly)\b/i.test(
        after,
      );
    if (!label && !hourly && !monthly && !annual) continue;
    const ote =
      /\bOTE\b|on[- ]target earnings|total (?:cash )?compensation|commission/i.test(
        label,
      ) ||
      /\binclud(?:es|ing)\b[^.\n]{0,30}\b(?:commission|bonus|equity)\b/i.test(
        after,
      );
    const other =
      /budget|allowance|reimbursement|stipend|bonus|equity|stock|relocation/i.test(
        label,
      );
    const conditionalOte =
      /\b(?:range (?:includes|provided)[^.\n]{0,120}(?:commissions?|bonuses)|for sales roles[^.\n]{0,160}\bOTE\b)/i.test(
        before + after,
      );
    const base =
      /\b(?:base|salary|salaries)\b/i.test(label) && !ote && !conditionalOte;
    let currency =
      currencyOf(g.prefix1) || currencyOf(g.prefix2) || currencyOf(g.suffix);
    if (!currency) {
      const nearby = [
        ...new Set(
          (context.match(/\b(?:USD|CAD|AUD|GBP|EUR)\b/gi) || []).map((c) =>
            c.toUpperCase(),
          ),
        ),
      ];
      if (nearby.length === 1) currency = nearby[0];
    }
    if (!currency) {
      const countries = jobGeography({ location }).countries;
      if (countries.length === 1)
        currency = countries[0] === "US" ? "USD" : "CAD";
    }
    let min = Number(g.min.replaceAll(",", "")),
      max = Number(g.max.replaceAll(",", ""));
    if (g.unit1 || (!g.unit1 && g.unit2 && min < 1000)) min *= 1000;
    if (g.unit2 || (!g.unit2 && g.unit1 && max < 1000)) max *= 1000;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min)
      continue;
    const kind = other
      ? "other-compensation"
      : ote
        ? "ote"
        : hourly
          ? "hourly"
          : monthly
            ? "monthly"
            : otherPeriod
              ? "other-period"
              : annual && base && currency
                ? "annual-base"
                : annual
                  ? "annual-unverified"
                  : "period-unverified";
    let summary = briefRange(match, currency);
    if (kind === "ote") summary += " OTE — base pay unverified";
    else if (kind === "hourly") summary += " / hour";
    else if (kind === "monthly") summary += " / month";
    else if (kind === "annual-unverified")
      summary += " / year — base pay unverified";
    else if (kind === "period-unverified")
      summary += " — pay period unverified";
    if (!currency) summary += " (currency unverified)";
    candidates.push({ min, max, currency, kind, summary });
  }
  const annual = candidates.filter((c) => c.kind === "annual-base");
  if (annual.length) {
    let selected = annual;
    const currencies = new Set(annual.map((c) => c.currency));
    if (currencies.size > 1) {
      const countries = jobGeography({ location }).countries;
      const preferred =
        countries.length === 1 ? (countries[0] === "US" ? "USD" : "CAD") : "";
      selected = annual.filter((c) => c.currency === preferred);
    }
    if (selected.length)
      return {
        salaryMin: Math.min(...selected.map((c) => c.min)),
        salaryMax: Math.max(...selected.map((c) => c.max)),
        currency: selected[0].currency,
        kind: "annual-base",
        mentioned: true,
        summary: "",
        multipleRanges:
          new Set(selected.map((c) => `${c.min}:${c.max}`)).size > 1,
      };
    return {
      salaryMin: 0,
      salaryMax: 0,
      currency: "",
      kind: "unverified",
      mentioned: true,
      summary: "Multiple currency ranges — see description",
    };
  }
  const candidate =
    candidates.find((c) => !["ote", "other-compensation"].includes(c.kind)) ||
    candidates.find((c) => c.kind === "ote") ||
    candidates[0];
  const line = salaryLine(text);
  return {
    salaryMin: 0,
    salaryMax: 0,
    currency: candidate?.currency || "",
    kind: candidate?.kind || "unverified",
    mentioned: mentioned || Boolean(candidate) || Boolean(line),
    summary:
      line ||
      candidate?.summary ||
      (mentioned ? "Compensation in description" : ""),
  };
}
