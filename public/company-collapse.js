export const companyKey = (value) =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export function companyGroups(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = companyKey(job.company);
    const group = groups.get(key) || { total: 0, collapsed: 0 };
    group.total++;
    if (job.collapsed) group.collapsed++;
    groups.set(key, group);
  }
  return groups;
}

export function setCompanyCollapsed(state, company, collapsed) {
  if (
    typeof company !== "string" ||
    !company.trim() ||
    typeof collapsed !== "boolean"
  )
    throw new Error("Choose a company and a collapse state.");
  const key = companyKey(company);
  const jobs = state.jobs.filter((job) => companyKey(job.company) === key);
  if (!jobs.length) throw new Error("No listings were found for this company.");
  for (const job of jobs) job.collapsed = collapsed;
  return { updated: jobs.length, collapsed };
}
