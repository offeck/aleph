import { describe, expect, it } from "vitest";
import {
  buildCodexPrimerRequest, buildClaudeCreateRequest,
  buildClaudeCompletionRequest, buildClaudeDeleteRequest, parseCodexPrimary,
} from "../../src/background/primerRequests";

describe("buildCodexPrimerRequest", () => {
  const r = buildCodexPrimerRequest({
    origin: "https://chatgpt.com", token: "T", accountId: "A",
    model: "gpt-5-codex-mini", greeting: "hi",
  });
  it("targets the responses endpoint with bearer + account id", () => {
    expect(r.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(r.method).toBe("POST");
    expect(r.headers.Authorization).toBe("Bearer T");
    expect(r.headers["ChatGPT-Account-ID"]).toBe("A");
    expect(r.headers.Accept).toBe("text/event-stream");
    expect(r.headers.originator).toBe("codex_cli_rs");
  });
  it("sends a non-empty instructions and store:false body", () => {
    const b = JSON.parse(r.body!);
    expect(b.instructions).toBeTruthy();
    expect(b.store).toBe(false);
    expect(b.stream).toBe(true);
    expect(b.input[0].content[0].text).toBe("hi");
  });
});

describe("Claude requests", () => {
  it("create posts name+uuid", () => {
    const r = buildClaudeCreateRequest("ORG", "U");
    expect(r.url).toBe("https://claude.ai/api/organizations/ORG/chat_conversations");
    expect(JSON.parse(r.body!)).toEqual({ name: "", uuid: "U" });
  });
  it("completion omits model and streams", () => {
    const r = buildClaudeCompletionRequest("ORG", "U", "hey", "Etc/UTC");
    expect(r.url).toBe("https://claude.ai/api/organizations/ORG/chat_conversations/U/completion");
    const b = JSON.parse(r.body!);
    expect(b).toEqual({ prompt: "hey", timezone: "Etc/UTC", attachments: [], files: [] });
    expect("model" in b).toBe(false);
  });
  it("delete targets the conversation with a quoted-uuid body", () => {
    const r = buildClaudeDeleteRequest("ORG", "U");
    expect(r.method).toBe("DELETE");
    expect(r.url).toBe("https://claude.ai/api/organizations/ORG/chat_conversations/U");
    expect(r.body).toBe('"U"');
  });
});

describe("parseCodexPrimary", () => {
  it("reads reset (unix s → ms) and used percent from headers", () => {
    const h = new Map([
      ["x-codex-primary-reset-at", "1000"],
      ["x-codex-primary-used-percent", "3"],
    ]);
    const p = parseCodexPrimary({ get: (n) => h.get(n) ?? null });
    expect(p.resetAt).toBe(1_000_000);
    expect(p.usedPercent).toBe(3);
  });
  it("returns nulls when headers are absent", () => {
    const p = parseCodexPrimary({ get: () => null });
    expect(p.resetAt).toBeNull();
    expect(p.usedPercent).toBeNull();
  });
});
