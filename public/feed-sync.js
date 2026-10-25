// Refresh public listing details while preserving private user decisions.
export function syncFeed(state, feed) {
  if (
    feed.version !== 1 ||
    !Array.isArray(feed.jobs) ||
    !Array.isArray(feed.sources) ||
    !feed.generatedAt
  )
    throw new Error("The company job feed has an unsupported format.");
  const seen = new Set();
  const healthy = new Set(
    feed.sources.filter((s) => s.status === "ok").map((s) => s.id),
  );
  const existing = new Map(state.jobs.map((j) => [j.id, j]));
  const reference = (job) =>
    job.feedSource && job.externalId
      ? `${job.feedSource}\n${job.externalId}`
      : "";
  const byPosting = new Map(
    state.jobs
      .filter((job) => reference(job))
      .map((job) => [reference(job), job]),
  );
  let added = 0;
  for (const job of feed.jobs) {
    if (!job.id || !job.title || !job.company || !job.feedSource || !job.url)
      throw new Error("Incomplete job in company feed.");
    const old = existing.get(job.id) || byPosting.get(reference(job));
    const id = old?.id || job.id;
    const updated = {
      ...job,
      id,
      status: old?.status || "feed",
      saved: old?.saved || false,
      collapsed: old?.collapsed || false,
      reason: old?.reason || "",
      fromFeed: true,
      closed: false,
    };
    existing.set(id, updated);
    seen.add(id);
    if (reference(updated)) byPosting.set(reference(updated), updated);
    if (!old) added++;
  }
  for (const job of existing.values()) {
    if (job.fromFeed && healthy.has(job.feedSource) && !seen.has(job.id))
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
