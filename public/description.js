import { safeUrl } from "./jobs.js";
import { descriptionMarkup, hasDescriptionHtml } from "./description-text.js";

const allowed = new Set([
  "P",
  "DIV",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "A",
  "BLOCKQUOTE",
  "PRE",
  "CODE",
  "HR",
  "DL",
  "DT",
  "DD",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
]);
const drop = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "TEMPLATE",
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "LINK",
  "META",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "FORM",
]);
function cleanNode(node, base, depth = 0, budget = { remaining: 5000 }) {
  if (depth > 40 || budget.remaining-- <= 0) return null;
  if (node.nodeType === Node.TEXT_NODE)
    return document.createTextNode(node.textContent);
  if (
    node.nodeType !== Node.ELEMENT_NODE ||
    drop.has(node.tagName.toUpperCase())
  )
    return null;
  const name =
    node.tagName.toUpperCase() === "H1" ? "H3" : node.tagName.toUpperCase();
  const output = allowed.has(name)
    ? document.createElement(name.toLowerCase())
    : document.createDocumentFragment();
  if (name === "A" && output.nodeType === Node.ELEMENT_NODE) {
    try {
      const href = safeUrl(new URL(node.getAttribute("href") || "", base).href);
      if (href && node.hasAttribute("href")) {
        output.href = href;
        output.target = "_blank";
        output.rel = "noopener noreferrer";
      }
    } catch {
      /* Keep link text when its target is invalid. */
    }
  }
  if (["OL", "LI"].includes(name)) {
    const attr = name === "OL" ? "start" : "value";
    const v = node.getAttribute(attr);
    if (v && /^-?\d{1,5}$/.test(v)) output.setAttribute(attr, v);
  }
  if (["TD", "TH"].includes(name))
    for (const attr of ["colspan", "rowspan"]) {
      const n = Number(node.getAttribute(attr));
      if (Number.isInteger(n) && n > 0 && n <= 20)
        output.setAttribute(attr, String(n));
    }
  for (const child of node.childNodes) {
    const cleaned = cleanNode(child, base, depth + 1, budget);
    if (cleaned) output.append(cleaned);
  }
  return output;
}
function plainDescription(text) {
  const fragment = document.createDocumentFragment();
  let paragraph, list, listType;
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      paragraph = null;
      list = null;
      listType = null;
      continue;
    }
    const bullet =
      /^\s*(?:[•●▪◦*\-–]\s+|(?<number>\d+)[.)]\s+)(?<content>.*)$/.exec(line);
    if (bullet) {
      paragraph = null;
      const type = bullet.groups.number ? "ol" : "ul";
      if (!list || listType !== type) {
        list = document.createElement(type);
        listType = type;
        if (type === "ol") list.start = Number(bullet.groups.number);
        fragment.append(list);
      }
      const item = document.createElement("li");
      item.textContent = bullet.groups.content;
      list.append(item);
    } else {
      list = null;
      listType = null;
      if (!paragraph) {
        paragraph = document.createElement("p");
        paragraph.className = "plain-description";
        fragment.append(paragraph);
      } else paragraph.append(document.createElement("br"));
      paragraph.append(document.createTextNode(line));
    }
  }
  return fragment;
}
export function postingUrl(job) {
  function original(value) {
    const safe = safeUrl(value);
    if (!safe) return "";
    const url = new URL(safe);
    if (
      /(^|\.)greenhouse\.io$/i.test(url.hostname) &&
      /\/embed\/job_app/i.test(url.pathname) &&
      /^[a-z0-9_-]+$/i.test(url.searchParams.get("for") || "") &&
      /^\d+$/.test(url.searchParams.get("token") || "")
    )
      return `https://job-boards.greenhouse.io/${url.searchParams.get("for")}/jobs/${url.searchParams.get("token")}`;
    if (
      /(^|\.)(?:lever\.co|ashbyhq\.com|greenhouse\.io|myworkdayjobs\.com)$/i.test(
        url.hostname,
      )
    ) {
      url.pathname = url.pathname.replace(
        /\/(?:apply|application)(?:\/.*)?\/?$/i,
        "",
      );
      if (/^(?:#app|#apply|#application)$/i.test(url.hash)) url.hash = "";
    }
    return url.href;
  }
  const primary = original(job.url),
    company = original(job.applicationUrl);
  if (
    primary &&
    company &&
    /(^|\.)linkedin\.com$/i.test(new URL(primary).hostname) &&
    /(^|\.)(?:lever\.co|ashbyhq\.com|greenhouse\.io|myworkdayjobs\.com)$/i.test(
      new URL(company).hostname,
    ) &&
    new URL(company).pathname.split("/").filter(Boolean).length >= 2 &&
    !/\/(?:embed|job_app|apply|application)(?:\/|$)/i.test(
      new URL(company).pathname,
    )
  )
    return company;
  return primary || company;
}
export function renderDescription(job) {
  const raw = job.descriptionHtml || job.description;
  if (!raw)
    return plainDescription("No description was included by this source.");
  if (!hasDescriptionHtml(raw)) return plainDescription(job.description || raw);
  // Template contents are inert; only newly created allowlisted nodes are attached.
  const template = document.createElement("template");
  template.innerHTML = descriptionMarkup(raw);
  const fragment = document.createDocumentFragment();
  const base = postingUrl(job) || location.href;
  const budget = { remaining: 5000 };
  for (const child of template.content.childNodes) {
    const clean = cleanNode(child, base, 0, budget);
    if (clean) fragment.append(clean);
  }
  return fragment;
}
