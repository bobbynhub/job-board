import { browserApi } from "./browser-api.js";
import { assess, roleMatches, seniorityMatches } from "./matching.js";
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const browserMode =
  document.querySelector('meta[name="shortlist-mode"]')?.content === "browser";
let board;
let tab = "feed";
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 6000);
}
async function api(url, method = "GET", data) {
  if (browserMode) return browserApi(url, method, data);
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
async function load() {
  board = await api("/api/board");
  render();
}
function modal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = html;
  if (!$("#modal").open) $("#modal").showModal();
}
$("#modal-close").onclick = () => $("#modal").close();
const money = (value, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
};
function salaryText(job) {
  return job.salaryMin
    ? `${money(job.salaryMin, job.currency)}${job.salaryMax ? " – " + money(job.salaryMax, job.currency) : "+"} / year`
    : job.salaryText || "Salary undisclosed";
}
const glyph = (company) => esc(company.trim().slice(0, 1).toUpperCase());
function profileOpen() {
  const p = board.profile;
  modal(
    "Your next role starts with you.",
    `<p class="modal-lead">Used only by this board. Matching checks the words in job descriptions; it is a guide, not an assessment of your qualifications.</p><form id="profile-form"><label>Target job titles <span>comma separated</span><input name="roles" value="${esc(p.roles.join(", "))}" placeholder="Frontend Engineer, Design Engineer" required></label><label>Your skills <span>comma separated</span><textarea name="skills" rows="3" placeholder="JavaScript, React, SQL, user research" required>${esc(p.skills.join(", "))}</textarea></label><div class="form-grid"><label>Years of experience<input name="years" type="number" min="0" max="80" value="${esc(p.years)}"></label><label>Work style<select name="workMode">${["Any", "Remote", "Hybrid", "On-site"].map((v) => `<option ${v === p.workMode ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><label>Location / region<input name="location" value="${esc(p.location)}" placeholder="e.g. United States"><small>Remote jobs may still restrict where you can work.</small></label><div class="form-grid"><label>Minimum annual base salary<input name="salaryMin" type="number" min="0" step="1000" value="${p.salaryMin || ""}" placeholder="150000"></label><label>Currency<select name="currency">${["USD", "EUR", "GBP", "CAD", "AUD"].map((v) => `<option ${v === p.currency ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><p class="hint">Only explicitly structured annual salary ranges count toward your floor. Raw salary text and other currencies remain unverified. Experience is checked when the source provides a numeric requirement.</p><button class="primary full">Save my profile ↗</button></form>`,
  );
  const extra = document.createElement("div");
  extra.innerHTML = `<label>Target seniority <span>comma separated; leave blank for any</span><input name="seniorities" value="${esc((p.seniorities || []).join(", "))}" placeholder="Senior, Lead, Principal, Staff, Director"></label><label class="check-label"><input name="strictRole" type="checkbox" ${p.strictRole ? "checked" : ""}> Only show my target roles and seniority in Discover</label>`;
  $("#profile-form").insertBefore(extra, $("#profile-form .full"));
  const transfer = document.createElement("div");
  transfer.className = "profile-transfer";
  transfer.innerHTML =
    '<hr><p class="hint">Profiles stay private. Move yours between the cloud app and this browser with a profile file.</p><button id="profile-export" class="secondary" type="button">Download profile</button><label>Import profile JSON<input id="profile-import" type="file" accept=".json,application/json"></label>';
  $("#modal-content").append(transfer);
  $("#profile-export").onclick = () => {
    const blob = new Blob([JSON.stringify(board.profile, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shortlist-profile.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("#profile-import").onchange = (e) =>
    action(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 100000)
        throw new Error("Choose a profile file under 100 KB.");
      await api("/api/profile", "PUT", JSON.parse(await file.text()));
      $("#modal").close();
      await load();
      toast(
        "Profile imported. Your data stays in this browser when using GitHub Pages.",
      );
    });

  $("#profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const values = Object.fromEntries(form);
    values.roles = values.roles
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    values.skills = values.skills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    values.seniorities = values.seniorities
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    values.strictRole = form.has("strictRole");
    await action(async () => {
      await api("/api/profile", "PUT", values);
      $("#minimum").value = "";
      $("#modal").close();
      await load();
      toast("Profile saved. Your matches are ready.");
    });
  };
}
$("#profile-open").onclick = () => board && profileOpen();
$("#profile-cta").onclick = () => board && profileOpen();
function render() {
  const p = board.profile;
  const hasProfile = p.skills.length || p.roles.length;
  $("#profile-summary").textContent = hasProfile
    ? `${p.roles.join(" / ") || "Your next role"}${p.salaryMin ? " · " + money(p.salaryMin, p.currency) + "+ / year" : ""}. Ranked around your skills and preferences.`
    : "Add your skills and salary expectations to see your strongest matches.";
  $("#profile-cta").innerHTML = hasProfile
    ? "Edit your profile <span>↗</span>"
    : "Build your profile <span>↗</span>";
  $("#currency-label").textContent = p.currency;
  if (browserMode)
    $(".workspace").textContent = "PRIVATE DATA · SAVED IN THIS BROWSER";
  $("#minimum").placeholder = p.salaryMin ? String(p.salaryMin) : "No minimum";
  if (!$("#live-query").value && p.roles[0])
    $("#live-query").value = p.roles[0];
  $("#demo-banner").hidden = !board.jobs.some((j) => j.demo);
  const currentSource = $("#source").value;
  $("#source").innerHTML =
    '<option value="">All sources</option>' +
    [...new Set(board.jobs.map((j) => j.source))]
      .sort()
      .map(
        (s) =>
          `<option ${s === currentSource ? "selected" : ""}>${esc(s)}</option>`,
      )
      .join("");
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const t = b.dataset.tab;
    b.classList.toggle("active", t === tab);
    b.setAttribute("aria-current", t === tab ? "page" : "false");
    b.querySelector("span").textContent = board.jobs.filter((j) =>
      t === "saved" ? j.saved && j.status !== "discarded" : j.status === t,
    ).length;
  });
  const query = $("#search").value.toLowerCase();
  const floor = Number($("#minimum").value || p.salaryMin || 0);
  let hidden = 0;
  const jobs = board.jobs
    .map((j) => ({ ...j, fit: assess(j, { ...p, salaryMin: floor }) }))
    .filter((j) => {
      if (
        tab === "saved"
          ? !j.saved || j.status === "discarded"
          : j.status !== tab
      )
        return false;
      if (
        tab === "feed" &&
        p.strictRole &&
        ((p.roles.length && !roleMatches(j.title, p.roles)) ||
          !seniorityMatches(j, p.seniorities))
      ) {
        hidden++;
        return false;
      }
      if (
        tab === "feed" &&
        (board.excludedCompanies.some(
          (c) => c.toLowerCase() === j.company.toLowerCase(),
        ) ||
          board.excludedKeywords.some((k) =>
            `${j.title} ${j.company} ${j.description}`
              .toLowerCase()
              .includes(k.toLowerCase()),
          ))
      ) {
        hidden++;
        return false;
      }
      if (
        query &&
        !`${j.title} ${j.company} ${j.description}`
          .toLowerCase()
          .includes(query)
      )
        return false;
      if ($("#work-mode").value && j.workMode !== $("#work-mode").value)
        return false;
      if ($("#seniority").value && j.seniority !== $("#seniority").value)
        return false;
      if ($("#source").value && j.source !== $("#source").value) return false;
      const size = $("#team-size").value;
      if (
        size &&
        (!j.teamSize ||
          (size === "small" && j.teamSize > 50) ||
          (size === "medium" && (j.teamSize <= 50 || j.teamSize > 200)) ||
          (size === "large" && j.teamSize <= 200))
      )
        return false;
      if (
        $("#posted").value &&
        (!Date.parse(j.postedAt) ||
          Date.now() - Date.parse(j.postedAt) >
            Number($("#posted").value) * 86400000)
      )
        return false;
      if ($("#sponsorship").checked && j.sponsorship !== "Available")
        return false;
      if (
        floor &&
        (j.fit.salary === "below" ||
          (!$("#unknown-pay").checked && j.fit.salary === "unknown"))
      )
        return false;
      return true;
    });
  jobs.sort((a, b) =>
    $("#sort").value === "salary"
      ? (b.currency === p.currency ? b.salaryMin : 0) -
        (a.currency === p.currency ? a.salaryMin : 0)
      : $("#sort").value === "recent"
        ? (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0)
        : (b.fit.score ?? -1) - (a.fit.score ?? -1),
  );
  $("#result-count").textContent =
    `${jobs.length} ${jobs.length === 1 ? "opportunity" : "opportunities"}${hidden ? ` · ${hidden} hidden by your preferences` : ""}`;
  $("#job-list").innerHTML = jobs.length
    ? jobs
        .map(
          (j, i) =>
            `<article class="job-card" data-id="${j.id}"><div class="job-top"><div class="company-icon tone-${j.company.length % 4}">${glyph(j.company)}</div><div class="company-line"><span>${esc(j.company)}</span><small>${esc(j.location)} <span>·</span> ${esc(j.source)}${j.demo ? " · SAMPLE" : ""}</small></div><button class="save-button ${j.saved ? "is-saved" : ""}" data-action="save" aria-label="${j.saved ? "Unsave" : "Save"} ${esc(j.title)}" title="Save job">${j.saved ? "◆" : "◇"}</button></div><div class="title-line"><h2>${esc(j.title)}</h2>${j.fit.score !== null ? `<button class="fit-badge ${j.fit.score >= 70 ? "strong" : ""}" data-action="fit">${j.fit.score}% fit ↗</button>` : ""}</div><div class="job-tags"><span>◷ ${esc(j.workMode)}</span><span>${esc(j.seniority)}</span><span>${esc(j.employment)}</span>${j.teamSize ? `<span>${j.teamSize} people</span>` : ""}</div>${hasProfile ? `<p class="match-line">${esc(j.fit.reasons.slice(0, 2).join(" · ") || "Review this role against your preferences")}${j.fit.warnings.length ? ` <span>· ${esc(j.fit.warnings[0])}</span>` : ""}</p>` : ""}${j.reason ? `<p class="discard-note">Discarded: ${esc(j.reason)}</p>` : ""}<div class="job-bottom"><strong>${esc(salaryText(j))}</strong><div class="card-actions"><button data-action="company" class="subtle">Company ↗</button><button data-action="details" class="secondary small">View role ↗</button></div></div></article>`,
        )
        .join("")
    : `<div class="empty-state"><span>↗</span><h2>A little room for possibility.</h2><p>${tab === "feed" ? "No jobs match these filters. Try widening your search or bringing in fresh jobs." : `Your ${tab} jobs will appear here.`}</p><button class="secondary" id="empty-reset">Reset filters</button></div>`;
  $("#empty-reset")?.addEventListener("click", resetFilters);
}
async function action(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  }
}
function resetFilters() {
  for (const id of [
    "search",
    "work-mode",
    "seniority",
    "source",
    "team-size",
    "posted",
    "minimum",
  ])
    $("#" + id).value = "";
  $("#unknown-pay").checked = true;
  $("#sponsorship").checked = false;
  render();
}
$("#reset-filters").onclick = resetFilters;
for (const id of [
  "search",
  "work-mode",
  "seniority",
  "source",
  "team-size",
  "posted",
  "minimum",
  "unknown-pay",
  "sponsorship",
  "sort",
])
  $("#" + id).addEventListener(
    id === "search" || id === "minimum" ? "input" : "change",
    () => board && render(),
  );
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      render();
    }),
);
$("#live-search").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    const button = e.target.querySelector("button");
    button.disabled = true;
    button.textContent = "Searching…";
    try {
      const result = await api("/api/search", "POST", {
        query: $("#live-query").value,
      });
      await load();
      toast(
        `${result.found} jobs found · ${result.added} added · ${result.duplicates} duplicates skipped`,
      );
    } finally {
      button.disabled = false;
      button.textContent = "Search live jobs ↗";
    }
  });
};
$("#remove-demo").onclick = () =>
  action(async () => {
    await api("/api/demo", "DELETE");
    await load();
    toast(
      "Sample jobs removed. Import jobs or search live to fill your board.",
    );
  });
function importOpen() {
  modal(
    "Bring your opportunities together.",
    `<p class="modal-lead">${browserMode ? "On GitHub Pages, import a public dataset or upload a JSON export from a private dataset. Never enter an API token here. " : ""}Import an existing Apify dataset or a JSON file. Duplicate company / title / location combinations are skipped. No paid scraping runs are started.</p><form id="apify-form"><label>Apify dataset ID<input name="datasetId" placeholder="Your dataset ID" required pattern="[a-zA-Z0-9]{1,64}"></label><p class="hint">${board.apifyConfigured ? "Server token configured." : "Public datasets work without a token. Private datasets need APIFY_TOKEN configured on the server; never paste it here."}</p><button class="primary">Import dataset ↓</button></form><div class="modal-divider">OR IMPORT A FILE</div><label>Jobs JSON file<input id="import-file" type="file" accept="application/json,.json"></label><details class="schema"><summary>Supported JSON format</summary><pre>[{ "title": "Frontend Engineer",
   "company": "Example",
   "location": "United States",
   "description": "React, TypeScript…",
   "workMode": "Remote",
   "salaryMin": 150000,
   "salaryMax": 180000,
   "currency": "USD",
   "minExperience": 5,
   "url": "https://example.com/jobs/1" }]</pre><p class="hint">salaryMin / salaryMax must be annual base pay. No currency conversions are inferred. Apify field aliases such as jobTitle, companyName and jobUrl are also accepted.</p></details>`,
  );
  const finish = async (data) => {
    const r = await api("/api/import", "POST", data);
    $("#modal").close();
    await load();
    toast(`${r.added} jobs added · ${r.duplicates} duplicates skipped`);
  };
  $("#apify-form").onsubmit = (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    action(async () => {
      try {
        await finish(Object.fromEntries(new FormData(e.target)));
      } finally {
        b.disabled = false;
      }
    });
  };
  $("#import-file").onchange = (e) =>
    action(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5e6) throw new Error("Choose a JSON file under 5 MB.");
      await finish({ jobs: JSON.parse(await file.text()) });
    });
}
$("#import-open").onclick = () => board && importOpen();
function details(job) {
  modal(
    job.title,
    `<div class="detail-company">${esc(job.company)} · ${esc(job.location)}</div><p class="salary-detail">${esc(salaryText(job))}</p><p class="description">${esc(job.description || "No description was included by this source.")}</p><div class="detail-actions">${job.url ? `<a class="primary" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View original & apply ↗</a>` : '<span class="hint">No application link provided.</span>'}<button id="mark-applied" class="secondary">${job.status === "applied" ? "Move back to feed" : "Mark applied"}</button><button id="discard-job" class="text-button">${job.status === "discarded" ? "Restore job" : "Discard job"}</button></div>`,
  );
  $("#mark-applied").onclick = () =>
    updateStatus(job, job.status === "applied" ? "feed" : "applied");
  $("#discard-job").onclick = () =>
    job.status === "discarded" ? updateStatus(job, "feed") : discard(job);
}
async function updateStatus(job, status, extra = {}) {
  await action(async () => {
    await api("/api/jobs/" + job.id, "PATCH", { status, ...extra });
    $("#modal").close();
    await load();
    toast(
      status === "applied"
        ? "Application tracked. Good luck!"
        : status === "feed"
          ? "Job restored."
          : "Feedback saved.",
    );
  });
}
function discard(job) {
  modal(
    "Make room for a better fit.",
    `<p class="modal-lead">Why isn’t ${esc(job.company)}’s role right for you? Your reason stays with the job. Only the company checkbox and search preferences change future filtering.</p><form id="discard-form"><label>Reason<select name="reason" required><option value="">Choose a reason</option><option>Salary too low</option><option>Skills don’t match</option><option>Too senior / too junior</option><option>Location or work style</option><option>Company values</option><option>Not interested</option></select></label><label class="check-label"><input name="excludeCompany" type="checkbox"> Hide future jobs from ${esc(job.company)}</label><button class="primary full">Discard & save feedback</button></form>`,
  );
  $("#discard-form").onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    updateStatus(job, "discarded", {
      reason: data.get("reason"),
      excludeCompany: data.has("excludeCompany"),
    });
  };
}
function company(job) {
  const info = board.companies[job.company] || {};
  modal(
    `A closer look at ${job.company}`,
    `<p class="modal-lead">${esc(job.industry || "Industry unknown")} · ${job.teamSize ? job.teamSize + " people (source supplied)" : "Team size unknown"}</p><p class="hint">${job.demo ? "This is a fictional demo company. " : ""}Company values and ethical standing require your judgment. No rating is inferred.</p><button id="research-company" class="secondary">Find public research ↗</button><div id="research-results" aria-live="polite"></div><form id="company-form"><label>Research notes<textarea name="notes" rows="5" placeholder="Mission, team, concerns, and what matters to you…">${esc(info.notes || "")}</textarea></label><label>Evidence / source URL<input name="source" type="url" value="${esc(info.source || "")}" placeholder="https://…"></label><button class="primary">Save company notes</button></form>`,
  );
  $("#company-form").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      await api("/api/company", "PUT", {
        company: job.company,
        ...Object.fromEntries(new FormData(e.target)),
      });
      $("#modal").close();
      await load();
      toast("Company research saved.");
    });
  };
  $("#research-company").onclick = () =>
    action(async () => {
      const b = $("#research-company");
      b.disabled = true;
      b.textContent = "Looking for sources…";
      try {
        const r = await api(
          "/api/research?company=" + encodeURIComponent(job.company),
        );
        $("#research-results").innerHTML =
          `<p class="hint">Possible Wikipedia matches. Confirm the identity before using these sources.</p>` +
          (r.results.length
            ? r.results
                .map(
                  (x) =>
                    `<div class="research-result"><a target="_blank" rel="noopener noreferrer" href="${esc(x.url)}">${esc(x.title)} ↗</a><p>${esc(x.snippet)}</p></div>`,
                )
                .join("")
            : "<p>No public matches found.</p>");
      } finally {
        b.disabled = false;
        b.textContent = "Find public research ↗";
      }
    });
}
$("#job-list").onclick = (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const job = board.jobs.find(
    (j) => j.id === button.closest("[data-id]").dataset.id,
  );
  if (!job) return;
  const a = button.dataset.action;
  if (a === "save")
    action(async () => {
      await api("/api/jobs/" + job.id, "PATCH", { saved: !job.saved });
      await load();
    });
  if (a === "details") details(job);
  if (a === "company") company(job);
  if (a === "fit") {
    const f = assess(job, board.profile);
    modal(
      "What’s behind this match?",
      `<p class="modal-lead">${f.score}% preference match. This is transparent keyword matching, not an AI prediction or a hiring probability.</p><h3>What lines up</h3><ul>${f.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul><h3>Skills mentioned</h3><p>${esc(f.matched.join(", ") || "None of your listed skills were found.")}</p><h3>Not mentioned</h3><p>${esc(f.missing.join(", ") || "All your listed skills were mentioned.")}</p><h3>Worth checking</h3><p>${esc(f.warnings.join(" · ") || "Review the description and confirm eligibility with the employer.")}</p><p class="hint">An absent keyword does not mean you are unqualified. Salary is assessed separately; a range overlapping your floor does not guarantee an offer at that amount. Remote does not mean worldwide.</p>`,
    );
  }
};
$("#preferences-open").onclick = () => {
  modal(
    "A feed with fewer wrong turns.",
    `<p class="modal-lead">These exclusions apply to Discover and future imports. Your saved, applied, and discarded history stays accessible.</p><form id="preferences-form"><label>Hidden companies <span>one per line</span><textarea name="excludedCompanies" rows="4">${esc(board.excludedCompanies.join("\n"))}</textarea></label><label>Excluded keywords <span>one per line</span><textarea name="excludedKeywords" rows="4" placeholder="e.g. unpaid internship">${esc(board.excludedKeywords.join("\n"))}</textarea></label><button class="primary full">Save search preferences</button></form>`,
  );
  $("#preferences-form").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const data = Object.fromEntries(new FormData(e.target));
      for (const k in data)
        data[k] = data[k]
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      await api("/api/preferences", "PUT", data);
      $("#modal").close();
      await load();
      toast("Preferences updated.");
    });
  };
};
load().catch((e) => {
  $("#result-count").textContent = "The board could not load.";
  toast(e.message);
});
