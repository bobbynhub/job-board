import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  apifyApi,
  resolveApifyTask,
  HARVEST_ACTOR_ID,
  validApifyId,
} from "./apify-api.js";
import { collectApify } from "./apify-jobs.js";

export function validateDailyBudget(account, actor, input) {
  const plan = account.plan;
  if (
    !plan ||
    plan.tier !== "FREE" ||
    plan.monthlyBasePriceUsd !== 0 ||
    plan.monthlyUsageCreditsUsd < 5
  )
    throw new Error(
      "Daily setup requires a verified free plan with at least $5 of monthly credit. No schedule was enabled.",
    );
  const pricing = (actor.pricingInfos || [])
    .filter(
      (p) =>
        p.pricingModel === "PAY_PER_EVENT" &&
        Date.parse(p.startedAt) <= Date.now(),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const events = pricing?.pricingPerEvent?.actorChargeEvents;
  if (
    events?.job?.eventPriceUsd !== 0.001 ||
    events?.["actor-start"]?.eventPriceUsd !== 0.001
  )
    throw new Error(
      "Scraper pricing has changed. Review the budget before enabling a schedule.",
    );
  if (
    !Array.isArray(input.jobTitles) ||
    input.jobTitles.length !== 3 ||
    !input.jobTitles.every((q) => typeof q === "string") ||
    input.locations?.length !== 1 ||
    input.locations[0] !== "United States"
  )
    throw new Error(
      "Daily setup expects the three grouped US-only searches. Existing input was preserved.",
    );
  const monthlyEstimate =
    (3 * 40 * events.job.eventPriceUsd + events["actor-start"].eventPriceUsd) *
    31;
  if (monthlyEstimate > 4 || 0.13 * 31 > plan.monthlyUsageCreditsUsd)
    throw new Error(
      "Configured daily limit would exceed the reserved free-plan budget.",
    );
  return { monthlyEstimate, monthlyCredit: plan.monthlyUsageCreditsUsd };
}
export async function configureDailyApify(env = process.env, request = fetch) {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN is missing.");
  const api = apifyApi(env, request);
  let initialRun;
  if (env.APIFY_RUN_ID) {
    if (!validApifyId(env.APIFY_RUN_ID))
      throw new Error("Invalid initial run identifier.");
    initialRun = (
      await api(`actor-runs/${encodeURIComponent(env.APIFY_RUN_ID)}`)
    ).data;
    if (
      initialRun.actId !== HARVEST_ACTOR_ID ||
      initialRun.status !== "SUCCEEDED"
    )
      throw new Error("The specified LinkedIn test has not succeeded.");
  }
  let id = initialRun?.actorTaskId;
  if (!id) {
    try {
      id = await resolveApifyTask(env, api);
    } catch (error) {
      if (!initialRun || error.code !== "TASK_NOT_FOUND") throw error;
    }
  }
  let task = id
    ? (await api(`actor-tasks/${encodeURIComponent(id)}`)).data
    : null;
  if (task && (task.actId !== HARVEST_ACTOR_ID || task.isPublic === true))
    throw new Error(
      "Setup requires the private HarvestAPI LinkedIn scraper task.",
    );
  let input;
  if (task) input = await api(`actor-tasks/${encodeURIComponent(id)}/input`);
  else {
    if (!validApifyId(initialRun?.defaultKeyValueStoreId || ""))
      throw new Error("A saved task or successful test input is required.");
    input = await api(
      `key-value-stores/${encodeURIComponent(initialRun.defaultKeyValueStoreId)}/records/INPUT`,
    );
  }
  const account = (await api("users/me")).data;
  const actor = (await api(`acts/${HARVEST_ACTOR_ID}`)).data;
  const budget = validateDailyBudget(account, actor, input);
  // Only existing completed results are read; setup never starts another paid run.
  const sample = await collectApify(
    {
      ...env,
      APIFY_TASK_ID: initialRun ? "" : id,
      APIFY_DATASET_IDS: initialRun ? initialRun.defaultDatasetId : "",
    },
    request,
  );
  if (sample.error || !sample.jobs?.length)
    throw new Error(
      sample.error || "The completed test has no importable listings yet.",
    );
  if (!task) {
    const created = await api("actor-tasks", "POST", {
      actId: HARVEST_ACTOR_ID,
      name: "shortlist-us-daily",
      title: "Shortlist US daily",
      description: `Shortlist initial run: ${env.APIFY_RUN_ID}`,
      input,
      options: {
        build: "latest",
        timeoutSecs: 300,
        maxTotalChargeUsd: 0.13,
        maxItems: 120,
        restartOnError: false,
      },
    });
    id = created.data.id;
    task = (await api(`actor-tasks/${encodeURIComponent(id)}`)).data;
    if (task.actId !== HARVEST_ACTOR_ID || task.isPublic === true)
      throw new Error(
        "Created task privacy could not be verified. No schedule was enabled.",
      );
  }
  const all = (await api("schedules?limit=1000")).data;
  if (!Array.isArray(all?.items) || all.total > all.items.length)
    throw new Error("Could not safely inspect existing schedules.");
  const related = all.items.filter((s) =>
    s.actions?.some((a) => a.actorTaskId === id),
  );
  if (
    related.length > 1 ||
    related.some(
      (s) => s.actions.length !== 1 || s.actions[0].type !== "RUN_ACTOR_TASK",
    )
  )
    throw new Error(
      "Multiple or shared schedules exist for this task. Consolidate them before automatic setup.",
    );
  const options = {
    ...(task.options || {}),
    maxTotalChargeUsd: 0.13,
    maxItems: 120,
    timeoutSecs: 300,
    restartOnError: false,
  };
  await api(`actor-tasks/${encodeURIComponent(id)}`, "PUT", { options });
  await api(`actor-tasks/${encodeURIComponent(id)}/input`, "PUT", {
    maxItems: 40,
  });
  const verified = (await api(`actor-tasks/${encodeURIComponent(id)}`)).data;
  const verifiedInput = await api(
    `actor-tasks/${encodeURIComponent(id)}/input`,
  );
  if (
    verified.options?.maxTotalChargeUsd !== 0.13 ||
    verified.options?.maxItems !== 120 ||
    verifiedInput.maxItems !== 40
  )
    throw new Error(
      "Daily limits could not be verified. No schedule was enabled.",
    );
  const desired = {
    name: "shortlist-us-daily",
    title: "Shortlist US daily",
    isEnabled: true,
    isExclusive: true,
    cronExpression: "0 7 * * *",
    timezone: "America/New_York",
    actions: [{ type: "RUN_ACTOR_TASK", actorTaskId: id }],
  };
  const result = related.length
    ? await api(
        `schedules/${encodeURIComponent(related[0].id)}`,
        "PUT",
        desired,
      )
    : await api("schedules", "POST", desired);
  const schedule = (
    await api(`schedules/${encodeURIComponent(result.data.id)}`)
  ).data;
  if (
    !schedule.isEnabled ||
    schedule.cronExpression !== "0 7 * * *" ||
    schedule.timezone !== "America/New_York"
  )
    throw new Error(
      "Schedule was saved but its final state could not be verified.",
    );
  return { ...budget, testListings: sample.jobs.length };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  http.setGlobalProxyFromEnv();
  try {
    const result = await configureDailyApify();
    console.log(
      `::notice title=Apify daily setup::Verified free monthly credit: $${result.monthlyCredit}. Daily scrape configured for 7 AM America/New_York, maximum 120 jobs and $0.13 per run. Estimated scraper fees for 31 days: $${result.monthlyEstimate.toFixed(2)}. Imported test listings: ${result.testListings}. No additional scrape was started.`,
    );
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
