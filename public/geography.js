const usCountry = /\b(?:united states(?: of america)?|usa|u\.?s\.?a?\.?)\b/i;
const caCountry = /\bcanada\b/i;
const usPlaces =
  /\b(?:new york|san francisco|seattle|boston|austin|chicago|atlanta|miami|denver|los angeles|san diego|washington|california|texas|massachusetts|colorado|florida|virginia|maryland|pennsylvania|illinois|oregon|ohio|michigan|arizona|utah|tennessee|new jersey|north carolina|south carolina)\b/i;
const caPlaces =
  /\b(?:toronto|montreal|montréal|ottawa|calgary|edmonton|winnipeg|halifax|ontario|quebec|québec|british columbia|alberta|nova scotia|manitoba|saskatchewan)\b/i;
const usStateCode =
  /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:\b|$)/;
export function geographySettings(input = {}) {
  return {
    countryPreference: ["any", "US_CA", "US", "CA"].includes(
      input.countryPreference,
    )
      ? input.countryPreference
      : "any",
    citizenship: ["unspecified", "US", "CA", "both", "neither"].includes(
      input.citizenship,
    )
      ? input.citizenship
      : "unspecified",
    allowCitizenAbroad: Boolean(input.allowCitizenAbroad),
    includeWorldwide: Boolean(input.includeWorldwide),
    includeUnknownLocations: Boolean(input.includeUnknownLocations),
  };
}
export function requiredCitizenships(description = "") {
  const text = String(description).replace(/u\.s\./gi, "US");
  const countries = [];
  for (const [code, nationality] of [
    ["US", "(?:US|United States|American)"],
    ["CA", "(?:Canadian|Canada)"],
  ]) {
    if (
      new RegExp(
        `\\bno\\s+${nationality}\\s+citizenship\\s+(?:is\\s+)?required`,
        "i",
      ).test(text)
    )
      continue;
    const patterns = [
      `\\bmust\\s+be\\s+(?:an?\\s+)?${nationality}\\s+citizen\\b`,
      `\\b${nationality}\\s+citizens?\\s+only\\b`,
      `\\b${nationality}\\s+citizenship\\s+(?:is\\s+)?required\\b`,
      `\\brequir(?:es?|ed)\\s+${nationality}\\s+citizenship\\b`,
    ];
    if (patterns.some((pattern) => new RegExp(pattern, "i").test(text)))
      countries.push(code);
  }
  return countries;
}
export function jobGeography(job, profile = {}) {
  const location = String(job.location || "");
  const codes = new Set();
  if (usCountry.test(location)) codes.add("US");
  if (caCountry.test(location)) codes.add("CA");
  if (!codes.size) {
    if (caPlaces.test(location)) codes.add("CA");
    else if (usPlaces.test(location) || usStateCode.test(location))
      codes.add("US");
  }
  const worldwide =
    /\b(?:worldwide|anywhere(?: in the world)?|global remote)\b/i.test(
      location,
    );
  const northAmerica = /\bnorth america\b/i.test(location);
  const requirements = requiredCitizenships(job.description);
  const held =
    profile.citizenship === "both"
      ? ["US", "CA"]
      : ["US", "CA"].includes(profile.citizenship)
        ? [profile.citizenship]
        : [];
  const citizenMatch = requirements.some((c) => held.includes(c));
  const knownCitizen =
    profile.citizenship && profile.citizenship !== "unspecified";
  const restricted = requirements.length && knownCitizen && !citizenMatch;
  const preference = profile.countryPreference || "any";
  let allowed = true;
  let label = codes.has("US")
    ? "U.S. location"
    : codes.has("CA")
      ? "Canadian location"
      : worldwide
        ? "Worldwide eligibility stated"
        : northAmerica
          ? "North American region; verify eligibility"
          : "Location eligibility unverified";
  let exception = false;
  if (preference !== "any") {
    const wanted = preference === "US_CA" ? ["US", "CA"] : [preference];
    const regional = wanted.some((code) => codes.has(code)) || northAmerica;
    exception =
      !regional && Boolean(profile.allowCitizenAbroad) && citizenMatch;
    const unknown =
      !codes.size &&
      !worldwide &&
      !northAmerica &&
      /^(?:remote|unspecified|not specified|unknown|)$/i.test(location.trim());
    allowed =
      regional ||
      exception ||
      (worldwide && Boolean(profile.includeWorldwide)) ||
      (unknown && Boolean(profile.includeUnknownLocations));
    if (exception)
      label = "Overseas role explicitly requiring your citizenship";
  }
  if (restricted) allowed = false;
  return {
    allowed,
    countries: [...codes],
    priority: codes.has("US") ? 2 : codes.has("CA") ? 1 : 0,
    label,
    exception,
    requirements,
    citizenshipWarning:
      requirements.length && !knownCitizen
        ? "Citizenship requirement needs verification"
        : restricted
          ? "Citizenship requirement does not match your profile"
          : "",
  };
}
