export const HARVEST_ACTOR_ID = "zn01OAlzP853oqn4Z";
export const validApifyId = (value) => /^[a-zA-Z0-9_~.-]{1,120}$/.test(value);
export function apifyApi(env = process.env, request = fetch) {
  return async (route, method = "GET", input) => {
    let response;
    try {
      response = await request("https://api.apify.com/v2/" + route, {
        method,
        headers: {
          ...(env.APIFY_TOKEN
            ? { Authorization: `Bearer ${env.APIFY_TOKEN}` }
            : {}),
          ...(input === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: input === undefined ? undefined : JSON.stringify(input),
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      });
    } catch {
      throw new Error("Could not reach the Apify API.");
    }
    if (!response.ok) {
      const error = new Error(
        `Apify API returned HTTP ${response.status}. Check repository configuration.`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
}
export async function resolveApifyTask(env, get) {
  if (env.APIFY_TASK_ID?.trim()) return env.APIFY_TASK_ID.trim();
  if (!env.APIFY_TOKEN || env.APIFY_DATASET_IDS?.trim()) return null;
  const result = await get("actor-tasks?limit=1000");
  const items = result.data?.items;
  if (!Array.isArray(items))
    throw new Error("Unsupported Apify task listing response.");
  if (result.data.total > items.length)
    throw new Error("Set APIFY_TASK_ID to select a task from this account.");
  const named = items.filter(
    (t) => t.name === (env.APIFY_TASK_NAME || "shortlist-us-daily"),
  );
  const candidates = named.length
    ? named
    : items.filter((t) => t.actId === HARVEST_ACTOR_ID);
  if (candidates.length !== 1 || !validApifyId(candidates[0].id)) {
    const error = new Error(
      "Could not uniquely identify the saved LinkedIn task. Set APIFY_TASK_ID or share the task link.",
    );
    error.code = candidates.length === 0 ? "TASK_NOT_FOUND" : "TASK_AMBIGUOUS";
    throw error;
  }
  return candidates[0].id;
}
export async function successfulTaskRun(id, api) {
  try {
    return (
      await api(
        `actor-tasks/${encodeURIComponent(id)}/runs/last?status=SUCCEEDED`,
      )
    ).data;
  } catch (error) {
    if (error.status !== 404) throw error;
    const task = (await api(`actor-tasks/${encodeURIComponent(id)}`)).data;
    const initial = /^Shortlist initial run: ([a-zA-Z0-9]+)$/.exec(
      task.description || "",
    );
    if (task.actId !== HARVEST_ACTOR_ID || !initial) throw error;
    const run = (await api(`actor-runs/${initial[1]}`)).data;
    if (run.actId !== HARVEST_ACTOR_ID || run.status !== "SUCCEEDED")
      throw new Error("The initial LinkedIn test is not available.");
    return run;
  }
}
