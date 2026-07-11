// Pure HTTP request builders + response parsing for the Window Primer.
// No chrome/fetch here — executors (primer.ts) run these.

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Codex: the metered turn that starts the 5h window (store:false → nothing persists). */
export function buildCodexPrimerRequest(o: {
  origin: string; token: string; accountId: string; model: string; greeting: string;
}): HttpRequest {
  return {
    url: o.origin + "/backend-api/codex/responses",
    method: "POST",
    headers: {
      "Authorization": "Bearer " + o.token,
      "ChatGPT-Account-ID": o.accountId,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "originator": "codex_cli_rs",
    },
    body: JSON.stringify({
      model: o.model,
      instructions: "You are a helpful assistant.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: o.greeting }] }],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: null,
      store: false,
      stream: true,
      include: [],
    }),
  };
}

export function buildClaudeCreateRequest(orgId: string, convUuid: string): HttpRequest {
  return {
    url: `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", uuid: convUuid }),
  };
}

/** The completion starts Claude's 5h window. `model` intentionally omitted (account default). */
export function buildClaudeCompletionRequest(orgId: string, convUuid: string, greeting: string, timezone: string): HttpRequest {
  return {
    url: `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}/completion`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({ prompt: greeting, timezone, attachments: [], files: [] }),
  };
}

export function buildClaudeDeleteRequest(orgId: string, convUuid: string): HttpRequest {
  return {
    url: `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}`,
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(convUuid),
  };
}

/** Codex rate-limit headers on the responses POST. reset-at is unix seconds. */
export function parseCodexPrimary(h: { get(name: string): string | null }): { resetAt: number | null; usedPercent: number | null } {
  const reset = h.get("x-codex-primary-reset-at");
  const used = h.get("x-codex-primary-used-percent");
  return {
    resetAt: reset ? Number(reset) * 1000 : null,
    usedPercent: used != null ? Number(used) : null,
  };
}

/**
 * Derive a Codex model slug the account actually has, from its wham/usage payload —
 * so the primer isn't pinned to a hardcoded slug that drifts across versions or is
 * plan-gated (e.g. gpt-5.3-codex-spark is Pro-only). Prefers a lightweight tier
 * (cheapest for a throwaway prime). Returns null when no Codex model is listed.
 */
export function pickCodexModel(
  wham: { additional_rate_limits?: Array<{ limit_name?: string; metered_feature?: string }> } | null | undefined,
): string | null {
  const list = wham?.additional_rate_limits;
  const arr = Array.isArray(list) ? list : [];
  const codex = arr.filter((e) => /codex/i.test(e?.limit_name || "") || /codex/i.test(e?.metered_feature || ""));
  if (!codex.length) return null;
  const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
  const light = codex.find((e) => /spark|mini|nano|lite|flash|fast/i.test(e?.limit_name || ""));
  const chosen = light || codex[0];
  return chosen.limit_name ? slugify(chosen.limit_name) : null;
}
