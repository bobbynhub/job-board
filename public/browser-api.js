import { readBoard, writeBoard } from "./storage.js";
import { geographySettings } from "./geography.js";
import { normalizeFields, jobKey, safeUrl } from "./jobs.js";
import { demoJobs } from "./demo.js";
import { syncFeed } from "./feed-sync.js";
import { setCompanyCollapsed } from "./company-collapse.js";

// The Pages build has no backend. Private state never leaves this browser.
const key = () =>
  `shortlist:v1:${location.pathname.replace(/index\.html$/, "")}`;
let memoryCatalog;
let pendingMutation = Promise.resolve();
function mutate(operation) {
  const next = pendingMutation.then(operation);
  pendingMutation = next.catch(() => {});
  return next;
}
async function normalize(raw) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(jobKey(raw)),
  );
  const id = [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
  return { id, ...normalizeFields(raw) };
}
async function read() {
  const existing = await readBoard();
  if (existing) return existing;
  const state = {
    jobs: await Promise.all(demoJobs().map(normalize)),
    companies: {},
    excludedCompanies: [],
    excludedKeywords: [],
    lastImport: null,
    profile: {
      skills: [],
      roles: [],
      seniorities: [],
      strictRole: false,
      years: "",
      salaryMin: 0,
      currency: "USD",
      workMode: "Any",
      location: "",
    },
  };
  await write(state);
  return state;
}
const write = writeBoard;
async function remote(url) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Error(
      "Could not reach the provider from this browser. Check your connection or import a JSON file instead.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Provider returned HTTP ${response.status}. Private Apify datasets must be exported as JSON and uploaded here; do not enter a token.`,
    );
  return response.json();
}
async function merge(state, rows) {
  if (!Array.isArray(rows) || rows.length > 5000)
    throw new Error("Import an array of up to 5,000 jobs.");
  // Validate the complete batch before changing stored data.
  const jobs = await Promise.all(rows.map(normalize));
  const ids = new Set(state.jobs.map((j) => j.id));
  let added = 0,
    duplicates = 0;
  for (const job of jobs) {
    if (ids.has(job.id)) {
      duplicates++;
      const old = state.jobs.find((item) => item.id === job.id);
      if (job.descriptionHtml) {
        old.description = job.description;
        old.descriptionHtml = job.descriptionHtml;
      }
      if (job.applicationUrl) old.applicationUrl = job.applicationUrl;
      continue;
    }
    ids.add(job.id);
    state.jobs.push(job);
    added++;
  }
  state.lastImport = new Date().toISOString();
  await write(state);
  return { added, duplicates };
}
async function catalog() {
  const cacheKey = key() + ":catalog";
  if (!memoryCatalog) {
    try {
      memoryCatalog = JSON.parse(localStorage.getItem(cacheKey));
    } catch {
      /* A corrupt public cache can be refreshed. */
    }
  }
  if (!memoryCatalog || Date.now() - memoryCatalog.time > 6 * 3600000) {
    const data = await remote("https://remotive.com/api/remote-jobs");
    if (!Array.isArray(data.jobs))
      throw new Error("Unsupported response from the job provider.");
    memoryCatalog = {
      time: Date.now(),
      jobs: data.jobs.map((j) => ({
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location,
        url: j.url,
        description: String(j.description || "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&amp;/g, "&"),
        descriptionHtml: j.description,
        source: "Remotive",
        workMode: "Remote",
        employment: j.job_type?.replaceAll("_", " "),
        salaryText: j.salary,
        postedAt: j.publication_date,
      })),
    };
    // A cache failure must not make a successful search fail. Jobs still need room to save.
    try {
      localStorage.setItem(cacheKey, JSON.stringify(memoryCatalog));
    } catch {
      localStorage.removeItem(cacheKey);
    }
  }
  return memoryCatalog.jobs;
}
async function dispatchBrowserApi(route, method = "GET", input = {}) {
  if (route === "/api/refresh-feed" && method === "POST") {
    let response;
    try {
      response = await fetch(new URL("./jobs-feed.json", location.href), {
        cache: "no-cache",
        credentials: "omit",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        "Could not sync the company feed. Your existing board is unchanged.",
      );
    }
    if (!response.ok)
      throw new Error(
        "The scheduled company feed is not available yet. Existing jobs are still saved.",
      );
    const feed = await response.json();
    return mutate(async () => {
      const current = await read();
      const result = syncFeed(current, feed);
      await write(current);
      return result;
    });
  }
  const state = await read();
  const url = new URL(route, location.origin);
  if (route === "/api/board" && method === "GET")
    return { ...state, apifyConfigured: false };
  if (route === "/api/company-collapse" && method === "PUT") {
    const result = setCompanyCollapsed(state, input.company, input.collapsed);
    await write(state);
    return result;
  }
  if (route === "/api/profile" && method === "PUT") {
    if (!Array.isArray(input.skills) || !Array.isArray(input.roles))
      throw new Error("The profile needs skills and roles lists.");
    const list = (v) =>
      (Array.isArray(v) ? v : [])
        .filter((x) => typeof x === "string")
        .map((x) => x.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 100);
    state.profile = {
      ...geographySettings(input),
      skills: list(input.skills),
      roles: list(input.roles),
      seniorities: list(input.seniorities),
      strictRole: Boolean(input.strictRole),
      years: String(input.years || "").slice(0, 3),
      salaryMin: Math.max(0, Number(input.salaryMin) || 0),
      currency: ["USD", "EUR", "GBP", "CAD", "AUD"].includes(input.currency)
        ? input.currency
        : "USD",
      workMode: ["Any", "Remote", "Hybrid", "On-site"].includes(input.workMode)
        ? input.workMode
        : "Any",
      location: String(input.location || "").slice(0, 200),
    };
  } else if (route === "/api/import" && method === "POST") {
    let rows = input.jobs;
    if (input.datasetId) {
      if (!/^[a-zA-Z0-9]{1,64}$/.test(input.datasetId))
        throw new Error("Enter a valid Apify dataset ID.");
      rows = await remote(
        `https://api.apify.com/v2/datasets/${input.datasetId}/items?clean=true&limit=5000`,
      );
    }
    return merge(state, rows);
  } else if (route === "/api/search" && method === "POST") {
    const term = String(input.query || state.profile.roles[0] || "")
      .trim()
      .slice(0, 150);
    if (!term)
      throw new Error("Enter a role or add target roles to your profile.");
    const tokens = term.toLowerCase().split(/\s+/);
    const rows = (await catalog()).filter((j) =>
      tokens.every((t) =>
        `${j.title} ${j.description}`.toLowerCase().includes(t),
      ),
    );
    return { ...(await merge(state, rows)), found: rows.length };
  } else if (url.pathname.startsWith("/api/jobs/") && method === "PATCH") {
    const job = state.jobs.find((j) => j.id === url.pathname.split("/").pop());
    if (!job) throw new Error("Job not found.");
    if (input.status !== undefined) {
      if (!["feed", "applied", "discarded"].includes(input.status))
        throw new Error("Invalid status.");
      if (input.status === "discarded" && !String(input.reason || "").trim())
        throw new Error("Choose a discard reason.");
      job.status = input.status;
      job.reason = String(input.reason || "").slice(0, 500);
    }
    if (typeof input.saved === "boolean") job.saved = input.saved;
    if (typeof input.collapsed === "boolean") job.collapsed = input.collapsed;
    if (
      input.excludeCompany &&
      job.status === "discarded" &&
      !state.excludedCompanies.includes(job.company)
    )
      state.excludedCompanies.push(job.company);
  } else if (route === "/api/preferences" && method === "PUT") {
    for (const field of ["excludedCompanies", "excludedKeywords"]) {
      if (
        !Array.isArray(input[field]) ||
        input[field].some((x) => typeof x !== "string")
      )
        throw new Error("Preferences must be lists of text.");
      state[field] = input[field]
        .map((x) => x.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 200);
    }
  } else if (route === "/api/company" && method === "PUT") {
    if (!state.jobs.some((j) => j.company === input.company))
      throw new Error("Unknown company.");
    state.companies[input.company] = {
      notes: String(input.notes || "").slice(0, 5000),
      source: safeUrl(input.source),
      updatedAt: new Date().toISOString(),
    };
  } else if (url.pathname === "/api/research" && method === "GET") {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: (url.searchParams.get("company") || "").slice(0, 200),
      srlimit: "3",
      format: "json",
      origin: "*",
    });
    const result = await remote(`https://en.wikipedia.org/w/api.php?${params}`);
    return {
      results: result.query.search.map((r) => ({
        title: r.title,
        snippet: r.snippet.replace(/<[^>]*>/g, ""),
        url: `https://en.wikipedia.org/?curid=${r.pageid}`,
      })),
    };
  } else if (route === "/api/demo" && method === "DELETE") {
    state.jobs = state.jobs.filter((j) => !j.demo);
  } else throw new Error("Unsupported operation.");
  await write(state);
  return { ok: true };
}
export async function browserApi(route, method = "GET", input = {}) {
  if (route === "/api/refresh-feed" && method === "POST")
    return dispatchBrowserApi(route, method, input);
  if (method === "GET") {
    await pendingMutation;
    return dispatchBrowserApi(route, method, input);
  }
  return mutate(() => dispatchBrowserApi(route, method, input));
}
