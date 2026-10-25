// Refresh public listing details while preserving private user decisions.
export function syncFeed(state, feed) {
  if (
    feed.version !== 1 ||
    !Array.isArray(feed.jobs) ||
    !Array.isArray(feed.sources) ||
    !feed.generatedAt
  )
    throw new Error("The company job feed has an unsupported format.");
  const ids = new Set(feed.jobs.map((j) => j.id));
  const healthy = new Set(
    feed.sources.filter((s) => s.status === "ok").map((s) => s.id),
  );
  const existing = new Map(state.jobs.map((j) => [j.id, j]));
  let added = 0;
  for (const job of feed.jobs) {
    if (!job.id || !job.title || !job.company || !job.feedSource || !job.url)
      throw new Error("Incomplete job in company feed.");
    const old = existing.get(job.id);
    existing.set(job.id, {
      ...job,
      status: old?.status || "feed",
      saved: old?.saved || false,
      reason: old?.reason || "",
      fromFeed: true,
      closed: false,
    });
    if (!old) added++;
  }
  for (const job of existing.values()) {
    if (job.fromFeed && healthy.has(job.feedSource) && !ids.has(job.id))
      job.closed = true;
  }
  // Replace untouched sample cards once real listings arrive. Preserve demo history.
  state.jobs = [...existing.values()].filter(
    (j) =>
      !(
        !state.feed &&
        feed.jobs.length &&
        j.demo &&
        !j.saved &&
        j.status === "feed"
      ),
  );
  state.feed = {
    generatedAt: feed.generatedAt,
    syncedAt: new Date().toISOString(),
    sources: feed.sources,
    count: feed.jobs.length,
  };
  return { added, total: feed.jobs.length };
}
