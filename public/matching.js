export function roleMatches(title, roles = []) {
  const canonical = (s) =>
    s
      .toLowerCase()
      .replace(/\bsolutions\b/g, "solution")
      .replace(/\barchitecture\b/g, "architect")
      .replace(/\bengineering\b/g, "engineer");
  const t = canonical(title);
  return roles.some((role) => t.includes(canonical(role)));
}
export function seniorityMatches(job, levels = []) {
  if (!levels.length) return true;
  const text = `${job.title} ${job.seniority}`.toLowerCase();
  return levels.some((level) =>
    level.toLowerCase() === "senior"
      ? /\b(senior|sr\.?)\b/.test(text)
      : new RegExp(
          `\\b${level.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        ).test(text),
  );
}
export function assess(job, profile = {}) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const skills = (profile.skills || []).filter(Boolean);
  const matched = skills.filter((skill) => {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(
      text,
    );
  });
  const missing = skills.filter((s) => !matched.includes(s));
  const reasons = [];
  const warnings = [];
  const components = [];
  if (skills.length) {
    components.push([matched.length / skills.length, 50]);
    reasons.push(`${matched.length}/${skills.length} skills mentioned`);
  }
  if (profile.roles?.length) {
    const match = roleMatches(job.title, profile.roles);
    components.push([match ? 1 : 0, 25]);
    (match ? reasons : warnings).push(
      match ? "Target role" : "Outside target roles",
    );
  }
  if (profile.seniorities?.length) {
    const match = seniorityMatches(job, profile.seniorities);
    components.push([match ? 1 : 0, 20]);
    (match ? reasons : warnings).push(
      match ? "Target seniority" : "Seniority not confirmed",
    );
  }
  if (profile.workMode && profile.workMode !== "Any") {
    const match = job.workMode.toLowerCase() === profile.workMode.toLowerCase();
    components.push([match ? 1 : 0, 15]);
    if (!match) warnings.push(`Work mode: ${job.workMode}`);
  }
  if (profile.location) {
    const match = job.location
      .toLowerCase()
      .includes(profile.location.toLowerCase());
    components.push([match ? 1 : 0, 10]);
    if (!match) warnings.push("Check location eligibility");
  }
  if (job.minExperience && profile.years !== "") {
    const match = Number(profile.years) >= job.minExperience;
    components.push([match ? 1 : 0, 15]);
    if (!match) warnings.push(`Requires ${job.minExperience}+ years`);
  }
  let salary = "unknown";
  if (
    profile.salaryMin > 0 &&
    job.salaryMin > 0 &&
    job.currency === profile.currency
  ) {
    salary =
      job.salaryMin >= profile.salaryMin
        ? "meets"
        : job.salaryMax >= profile.salaryMin
          ? "overlap"
          : "below";
    if (salary === "meets") reasons.push("Salary floor met");
    else
      warnings.push(
        salary === "overlap"
          ? "Only upper salary range meets your floor"
          : "Below your salary floor",
      );
  } else if (profile.salaryMin > 0)
    warnings.push(
      job.salaryMin && job.currency !== profile.currency
        ? "Salary currency differs"
        : "Salary undisclosed",
    );
  const weight = components.reduce((sum, c) => sum + c[1], 0);
  return {
    score: weight
      ? Math.round(
          (components.reduce((sum, c) => sum + c[0] * c[1], 0) / weight) * 100,
        )
      : null,
    matched,
    missing,
    reasons,
    warnings,
    salary,
  };
}
