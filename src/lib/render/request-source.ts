export type RenderRequestSource = "manual" | "scheduled" | "automatic";

/** Keep the origin stable when progress messages replace the original queue message. */
export function renderRequestSource(job: {
  metadata?: Record<string, unknown> | null;
  message: string;
  scheduledAt?: unknown;
}): RenderRequestSource {
  const source = job.metadata?.request_source;
  if (source === "manual" || source === "scheduled" || source === "automatic") return source;
  if (job.message.startsWith("自動レンダー")) return "automatic";
  return job.scheduledAt ? "scheduled" : "manual";
}

export function automaticRenderingAllowed(dependencies: Record<string, unknown>): boolean {
  const stats = dependencies.render_stats;
  const policy = stats && typeof stats === "object" && "start_policy" in stats
    ? stats.start_policy : dependencies.start_policy;
  // Older renderers do not report the policy; explicit denial is authoritative.
  return !(policy && typeof policy === "object" && "allowed" in policy && policy.allowed === false);
}
