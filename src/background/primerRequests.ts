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
