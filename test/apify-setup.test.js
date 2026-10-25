import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveApifyTask,
  HARVEST_ACTOR_ID,
  successfulTaskRun,
} from "../scripts/apify-api.js";
import {
  configureDailyApify,
  validateDailyBudget,
} from "../scripts/configure-apify.js";
import { collectApify } from "../scripts/apify-jobs.js";
const input = {
  jobTitles: ["query one", "query two", "query three"],
  locations: ["United States"],
  maxItems: 10,
};
const account = {
  plan: { tier: "FREE", monthlyBasePriceUsd: 0, monthlyUsageCreditsUsd: 5 },
};
const actor = {
  pricingInfos: [
    {
      pricingModel: "PAY_PER_EVENT",
      startedAt: "2025-01-01",
      pricingPerEvent: {
        actorChargeEvents: {
          job: { eventPriceUsd: 0.001 },
          "actor-start": { eventPriceUsd: 0.001 },
        },
      },
    },
  ],
};
test("an initial actor run remains readable until the new saved task has its own successful run", async () => {
  const run = await successfulTaskRun("newTask", async (route) => {
    if (route.includes("runs/last")) {
      const error = new Error("Not found");
      error.status = 404;
      throw error;
    }
    if (route === "actor-tasks/newTask")
      return {
        data: {
          actId: HARVEST_ACTOR_ID,
          description: "Shortlist initial run: completedRun",
        },
      };
    if (route === "actor-runs/completedRun")
      return {
        data: {
          actId: HARVEST_ACTOR_ID,
          status: "SUCCEEDED",
          defaultDatasetId: "dataset",
        },
      };
    throw new Error("Unexpected route");
  });
  assert.equal(run.defaultDatasetId, "dataset");
});
test("run-only setup creates a private capped task after budget and result verification without rerunning the actor", async () => {
  function provider(plan = account) {
    let task,
      schedule,
      currentInput = { ...input },
      checkedAccount = false,
      checkedResults = false;
    const writes = [];
    const request = async (url, config) => {
      const u = new URL(url),
        route = u.pathname.replace("/v2/", "") + u.search;
      const body = config.body ? JSON.parse(config.body) : undefined;
      let result;
      if (config.method !== "GET")
        writes.push({ route, method: config.method });
      if (route === "actor-runs/completedRun")
        result = {
          data: {
            actId: HARVEST_ACTOR_ID,
            status: "SUCCEEDED",
            defaultDatasetId: "dataset",
            defaultKeyValueStoreId: "store",
          },
        };
      else if (route === "actor-tasks?limit=1000")
        result = { data: { items: [], total: 0 } };
      else if (route === "key-value-stores/store/records/INPUT")
        result = currentInput;
      else if (route === "users/me") {
        checkedAccount = true;
        result = { data: plan };
      } else if (route === `acts/${HARVEST_ACTOR_ID}`) result = { data: actor };
      else if (route.startsWith("datasets/")) {
        checkedResults = true;
        result = [
          {
            title: "Principal Enterprise Architect",
            company: "Example",
            url: "https://example.com/job",
          },
        ];
      } else if (route === "actor-tasks" && config.method === "POST") {
        assert.ok(checkedAccount && checkedResults);
        task = { id: "newTask", isPublic: false, ...body };
        result = { data: task };
      } else if (route === "actor-tasks/newTask") {
        if (body) task = { ...task, ...body };
        result = { data: task };
      } else if (route === "actor-tasks/newTask/input") {
        if (body) currentInput = { ...currentInput, ...body };
        result = currentInput;
      } else if (route === "schedules?limit=1000")
        result = { data: { items: [], total: 0 } };
      else if (route === "schedules" && config.method === "POST") {
        schedule = { id: "newSchedule", ...body };
        result = { data: schedule };
      } else if (route === "schedules/newSchedule") result = { data: schedule };
      else throw new Error("Unexpected route");
      return { ok: true, json: async () => result };
    };
    return { request, writes, getTask: () => task };
  }
  const success = provider();
  await configureDailyApify(
    { APIFY_TOKEN: "fixture", APIFY_RUN_ID: "completedRun" },
    success.request,
  );
  assert.equal(success.getTask().options.maxTotalChargeUsd, 0.13);
  assert.equal(
    success.getTask().description,
    "Shortlist initial run: completedRun",
  );
  assert.equal(
    success.writes.filter((w) => w.route === "actor-tasks").length,
    1,
  );
  assert.equal(
    success.writes.some((w) => w.route.includes("/runs")),
    false,
  );
  const denied = provider({ plan: { ...account.plan, tier: "PAID" } });
  await assert.rejects(
    () =>
      configureDailyApify(
        { APIFY_TOKEN: "fixture", APIFY_RUN_ID: "completedRun" },
        denied.request,
      ),
    /free plan/,
  );
  assert.equal(denied.writes.length, 0);
});
test("saved task discovery selects a unique known task without exposing identifiers or making paid calls", async () => {
  assert.equal(
    await resolveApifyTask({ APIFY_TOKEN: "fixture" }, async () => ({
      data: {
        items: [
          { id: "known", name: "shortlist-us-daily", actId: HARVEST_ACTOR_ID },
        ],
        total: 1,
      },
    })),
    "known",
  );
  await assert.rejects(
    () =>
      resolveApifyTask({ APIFY_TOKEN: "fixture" }, async () => ({
        data: {
          items: [
            { id: "a", actId: HARVEST_ACTOR_ID },
            { id: "b", actId: HARVEST_ACTOR_ID },
          ],
          total: 2,
        },
      })),
    /uniquely/,
  );
  const calls = [];
  const result = await collectApify(
    { APIFY_TOKEN: "fixture" },
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.includes("actor-tasks?")
            ? {
                data: {
                  items: [
                    {
                      id: "known",
                      name: "shortlist-us-daily",
                      actId: HARVEST_ACTOR_ID,
                    },
                  ],
                  total: 1,
                },
              }
            : url.includes("runs/last")
              ? {
                  data: {
                    status: "SUCCEEDED",
                    defaultDatasetId: "exampleDataset",
                  },
                }
              : [
                  {
                    title: "Senior Solutions Architect",
                    company: "Example",
                    url: "https://example.com/job",
                  },
                ],
      };
    },
  );
  assert.equal(result.jobs.length, 1);
  assert.ok(calls.every((c) => c.options.method === "GET"));
  assert.doesNotMatch(JSON.stringify(result), /exampleDataset|fixture|"known"/);
});
test("daily budget guard rejects paid plans, changed pricing and extra locations before scheduling", () => {
  assert.equal(
    validateDailyBudget(account, actor, input).monthlyEstimate,
    3.751,
  );
  assert.throws(
    () =>
      validateDailyBudget(
        { plan: { ...account.plan, tier: "PAID" } },
        actor,
        input,
      ),
    /free plan/,
  );
  assert.throws(
    () => validateDailyBudget(account, { pricingInfos: [] }, input),
    /pricing/,
  );
  assert.throws(
    () =>
      validateDailyBudget(account, actor, {
        ...input,
        locations: ["United States", "Canada"],
      }),
    /US-only/,
  );
});
test("daily setup verifies test data, applies run caps and creates one timezone-aware schedule without running an actor", async () => {
  let options = {};
  let currentInput = { ...input };
  let schedule;
  const calls = [];
  const request = async (url, config) => {
    const route =
      new URL(url).pathname.replace("/v2/", "") + new URL(url).search;
    const body = config.body ? JSON.parse(config.body) : undefined;
    calls.push({ route, method: config.method, body });
    let data;
    if (route === "actor-tasks?limit=1000")
      data = {
        data: {
          items: [
            {
              id: "known",
              name: "shortlist-us-daily",
              actId: HARVEST_ACTOR_ID,
            },
          ],
          total: 1,
        },
      };
    else if (route === "actor-tasks/known") {
      if (config.method === "PUT") options = body.options;
      data = {
        data: {
          id: "known",
          actId: HARVEST_ACTOR_ID,
          isPublic: false,
          options,
        },
      };
    } else if (route === "actor-tasks/known/input") {
      if (config.method === "PUT") currentInput = { ...currentInput, ...body };
      data = currentInput;
    } else if (route === "users/me") data = { data: account };
    else if (route === `acts/${HARVEST_ACTOR_ID}`) data = { data: actor };
    else if (route === "actor-tasks/known/runs/last?status=SUCCEEDED")
      data = { data: { status: "SUCCEEDED", defaultDatasetId: "dataset" } };
    else if (route.startsWith("datasets/"))
      data = [
        {
          title: "Senior Solutions Architect",
          company: "Example",
          url: "https://example.com/job",
        },
      ];
    else if (route === "schedules?limit=1000")
      data = { data: { items: [], total: 0 } };
    else if (route === "schedules" && config.method === "POST") {
      schedule = { id: "schedule", ...body };
      data = { data: schedule };
    } else if (route === "schedules/schedule") data = { data: schedule };
    else throw new Error("Unexpected route");
    return { ok: true, json: async () => data };
  };
  const result = await configureDailyApify({ APIFY_TOKEN: "fixture" }, request);
  assert.equal(result.monthlyCredit, 5);
  assert.equal(result.testListings, 1);
  assert.equal(options.maxTotalChargeUsd, 0.13);
  assert.equal(options.maxItems, 120);
  assert.equal(currentInput.maxItems, 40);
  assert.equal(schedule.timezone, "America/New_York");
  assert.equal(schedule.cronExpression, "0 7 * * *");
  assert.equal(
    calls.some((c) => c.method === "POST" && c.route.includes("runs")),
    false,
  );
});
