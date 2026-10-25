import { test } from "node:test";
import assert from "node:assert/strict";
import {
  jobGeography,
  requiredCitizenships,
  geographySettings,
} from "../public/geography.js";
const profile = {
  countryPreference: "US_CA",
  citizenship: "both",
  allowCitizenAbroad: true,
  includeWorldwide: false,
  includeUnknownLocations: false,
};
test("country focus includes US and Canada, prioritizes US and excludes overseas or unspecified remote locations", () => {
  assert.equal(
    jobGeography({ location: "Remote, United States" }, profile).allowed,
    true,
  );
  assert.equal(
    jobGeography({ location: "San Francisco, CA" }, profile).countries[0],
    "US",
  );
  assert.equal(
    jobGeography({ location: "Toronto, Ontario" }, profile).countries[0],
    "CA",
  );
  assert.ok(
    jobGeography({ location: "New York, NY" }, profile).priority >
      jobGeography({ location: "Remote, Canada" }, profile).priority,
  );
  for (const location of [
    "London, United Kingdom",
    "Singapore",
    "Berlin, Germany",
    "Remote",
    "Remote — EMEA",
    "Worldwide",
  ])
    assert.equal(jobGeography({ location }, profile).allowed, false, location);
  assert.equal(
    jobGeography(
      { location: "Worldwide" },
      { ...profile, includeWorldwide: true },
    ).allowed,
    true,
  );
  assert.equal(
    jobGeography(
      { location: "Remote" },
      { ...profile, includeUnknownLocations: true },
    ).allowed,
    true,
  );
  assert.equal(
    jobGeography({ location: "Remote, North America" }, profile).allowed,
    true,
  );
});
test("overseas citizenship exceptions require explicit positive language and matching private citizenship", () => {
  const us = {
    location: "London, United Kingdom",
    description: "This role requires U.S. citizenship.",
  };
  assert.equal(jobGeography(us, profile).exception, true);
  assert.equal(
    jobGeography(us, { ...profile, citizenship: "unspecified" }).allowed,
    false,
  );
  assert.equal(
    jobGeography(us, { ...profile, citizenship: "CA" }).allowed,
    false,
  );
  assert.equal(
    jobGeography(
      { location: "Paris, France", description: "Canadian citizens only." },
      profile,
    ).allowed,
    true,
  );
  for (const description of [
    "US citizenship is not required",
    "No US citizenship required",
    "Our company has US citizens on its team",
  ])
    assert.deepEqual(requiredCitizenships(description), []);
  assert.equal(
    jobGeography(
      { location: "US", description: "Must be a US citizen." },
      { ...profile, citizenship: "CA" },
    ).allowed,
    false,
  );
  assert.equal(
    jobGeography(
      {
        location: "London, United Kingdom",
        description: "Company headquarters are in the United States.",
      },
      profile,
    ).allowed,
    false,
  );
});
test("geography defaults are neutral and do not assume citizenship", () => {
  const defaults = geographySettings({});
  assert.equal(defaults.citizenship, "unspecified");
  assert.equal(defaults.countryPreference, "any");
  assert.equal(jobGeography({ location: "Germany" }, defaults).allowed, true);
});
