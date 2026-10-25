import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mergeJobs, safeUrl } from "./lib.js";
import { seedJobs } from "./seed.js";

// Respect the cloud's egress proxy, including HTTPS secret injection.
http.setGlobalProxyFromEnv();

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, "data");
mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "board.json");
let state;
try {
  state = JSON.parse(readFileSync(dbPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  state = {
    jobs: seedJobs(),
    companies: {},
    excludedCompanies: [],
    excludedKeywords: [],
    lastImport: null,
  };
}
function save() {
  writeFileSync(`${dbPath}.tmp`, JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  renameSync(`${dbPath}.tmp`, dbPath);
}
save();
state.profile ||= {
  skills: [],
  roles: [],
  years: "",
  salaryMin: 0,
  currency: "USD",
  workMode: "Any",
  location: "",
};
const searchCache = new Map();
let lastSearch = 0;
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 5e6) throw new Error("Request exceeds 5 MB.");
  }
  return JSON.parse(data || "{}");
}
async function external(url, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      `Could not reach ${new URL(url).hostname}. Check this domain in environment network settings and retry.`,
    );
  }
  if (!response.ok)
    throw new Error(
      `Provider returned HTTP ${response.status}. Check access and configuration.`,
    );
  return response.json();
}
export const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    )
      return json(res, 403, { error: "Cross-origin writes are not allowed." });
    if (url.pathname === "/api/board" && req.method === "GET")
      return json(res, 200, {
        ...state,
        apifyConfigured: Boolean(process.env.APIFY_TOKEN),
      });
    if (url.pathname === "/api/profile" && req.method === "PUT") {
      const input = await body(req);
      if (!Array.isArray(input.skills) || !Array.isArray(input.roles))
        throw new Error("Skills and roles must be lists.");
      const list = (values) =>
        values
          .filter((v) => typeof v === "string")
          .slice(0, 100)
          .map((v) => v.trim().slice(0, 100))
          .filter(Boolean);
      state.profile = {
        skills: list(input.skills),
        roles: list(input.roles),
        seniorities: list(
          Array.isArray(input.seniorities) ? input.seniorities : [],
        ),
        strictRole: Boolean(input.strictRole),
        years: String(input.years || "").slice(0, 3),
        salaryMin: Math.max(0, Number(input.salaryMin) || 0),
        currency: ["USD", "EUR", "GBP", "CAD", "AUD"].includes(input.currency)
          ? input.currency
          : "USD",
        workMode: ["Any", "Remote", "Hybrid", "On-site"].includes(
          input.workMode,
        )
          ? input.workMode
          : "Any",
        location: String(input.location || "").slice(0, 200),
      };
      save();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/search" && req.method === "POST") {
      const input = await body(req);
      const term = String(input.query || state.profile.roles[0] || "")
        .trim()
        .slice(0, 150);
      if (!term)
        throw new Error(
          "Add a target role to your profile or enter a search term.",
        );
      let rows = searchCache.get(term);
      if (!rows || Date.now() - rows.time > 3600000) {
        if (Date.now() - lastSearch < 60000)
          throw new Error(
            "Please wait a minute before searching a different role.",
          );
        lastSearch = Date.now();
        const result = await external(
          `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=100`,
        );
        rows = {
          time: Date.now(),
          jobs: result.jobs.map((j) => ({
            title: j.title,
            company: j.company_name,
            location: j.candidate_required_location,
            url: j.url,
            description: j.description
              .replace(/<[^>]*>/g, " ")
              .replace(/&amp;/g, "&"),
            source: "Remotive",
            workMode: "Remote",
            employment: j.job_type?.replaceAll("_", " "),
            salaryText: j.salary,
            postedAt: j.publication_date,
          })),
        };
        searchCache.set(term, rows);
      }
      const result = mergeJobs(state.jobs, rows.jobs);
      state.jobs = result.jobs;
      state.lastImport = new Date().toISOString();
      save();
      return json(res, 200, {
        added: result.added,
        duplicates: result.duplicates,
        found: rows.jobs.length,
      });
    }
    if (url.pathname === "/api/import" && req.method === "POST") {
      const input = await body(req);
      let rows;
      if (input.datasetId) {
        if (!/^[a-zA-Z0-9]{1,64}$/.test(input.datasetId))
          throw new Error("Enter a valid Apify dataset ID.");
        rows = await external(
          `https://api.apify.com/v2/datasets/${input.datasetId}/items?clean=true&limit=5000`,
          process.env.APIFY_TOKEN
            ? { Authorization: `Bearer ${process.env.APIFY_TOKEN}` }
            : {},
        );
      } else rows = input.jobs;
      const result = mergeJobs(state.jobs, rows);
      state.jobs = result.jobs;
      state.lastImport = new Date().toISOString();
      save();
      return json(res, 200, {
        added: result.added,
        duplicates: result.duplicates,
      });
    }
    if (url.pathname.startsWith("/api/jobs/") && req.method === "PATCH") {
      const job = state.jobs.find(
        (j) => j.id === url.pathname.split("/").pop(),
      );
      if (!job) return json(res, 404, { error: "Job not found." });
      const input = await body(req);
      if (input.status !== undefined) {
        if (!["feed", "applied", "discarded"].includes(input.status))
          throw new Error("Invalid status.");
        if (input.status === "discarded" && !String(input.reason || "").trim())
          throw new Error("Choose a discard reason.");
        job.status = input.status;
        job.reason = String(input.reason || "").slice(0, 500);
      }
      if (typeof input.saved === "boolean") job.saved = input.saved;
      if (
        input.excludeCompany &&
        job.status === "discarded" &&
        !state.excludedCompanies.includes(job.company)
      )
        state.excludedCompanies.push(job.company);
      save();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/preferences" && req.method === "PUT") {
      const input = await body(req);
      for (const field of ["excludedCompanies", "excludedKeywords"]) {
        if (
          !Array.isArray(input[field]) ||
          input[field].some((x) => typeof x !== "string")
        )
          throw new Error("Preferences must be lists of text.");
      }
      state.excludedCompanies = input.excludedCompanies
        .slice(0, 200)
        .map((s) => s.slice(0, 200));
      state.excludedKeywords = input.excludedKeywords
        .slice(0, 200)
        .map((s) => s.slice(0, 200));
      save();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/research" && req.method === "GET") {
      const company = (url.searchParams.get("company") || "").slice(0, 200);
      const query = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: company,
        srlimit: "3",
        format: "json",
      });
      const result = await external(
        `https://en.wikipedia.org/w/api.php?${query}`,
        { "User-Agent": "PersonalJobBoard/1.0" },
      );
      return json(res, 200, {
        results: result.query.search.map((r) => ({
          title: r.title,
          snippet: r.snippet.replace(/<[^>]*>/g, ""),
          url: `https://en.wikipedia.org/?curid=${r.pageid}`,
        })),
      });
    }
    if (url.pathname === "/api/company" && req.method === "PUT") {
      const input = await body(req);
      if (!state.jobs.some((j) => j.company === input.company))
        throw new Error("Unknown company.");
      state.companies[input.company] = {
        notes: String(input.notes || "").slice(0, 5000),
        source: safeUrl(input.source),
        updatedAt: new Date().toISOString(),
      };
      save();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/demo" && req.method === "DELETE") {
      state.jobs = state.jobs.filter((j) => !j.demo);
      save();
      return json(res, 200, { ok: true });
    }
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/matching.js": "matching.js",
      "/style.css": "style.css",
    };
    if (req.method === "GET" && files[url.pathname]) {
      const filename = files[url.pathname];
      res.writeHead(200, {
        "Content-Type": filename.endsWith(".js")
          ? "text/javascript"
          : filename.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
      return res.end(readFileSync(path.join(root, "public", filename)));
    }
    json(res, 404, { error: "Not found." });
  } catch (error) {
    json(res, 400, {
      error: error.message?.includes("Bearer")
        ? "Provider request failed."
        : error.message || "Request failed.",
    });
  }
});
if (process.argv[1] === fileURLToPath(import.meta.url))
  server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(`Job board listening on port ${process.env.PORT || 3000}`),
  );
