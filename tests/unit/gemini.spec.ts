import { describe, expect, it } from "vitest";
import { parseGeminiQuotas } from "../../src/tracker/usageGemini";

// Payloads below were captured live from the qpEbW RPC (2026-06) while
// verifying the credit-pool schema — see the comment block in usageGemini.ts.

describe("parseGeminiQuotas — credit pool (current account shape)", () => {
  it("maps the anonymous pool row to credits", () => {
    const { credits, features } = parseGeminiQuotas([
      [[[], 2, 0, [1780679819, 293309000], 2400, 2382]],
      "",
    ]);
    expect(features).toEqual([]);
    expect(credits).toEqual({
      limit: 2400,
      remaining: 2382,
      used: 18,
      resetsAt: new Date(1780679819 * 1000).toISOString(),
    });
  });

  it("keeps feature-labelled rows as features without promoting to credits", () => {
    const { credits, features } = parseGeminiQuotas([
      [[[null, 4], 2, 0, [1780679819, 293309000], 2400, 2382]],
      "e6fa609c3fa255c0",
    ]);
    expect(credits).toBeNull();
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ id: 4, name: "Pro 3.1", limit: 2400, remaining: 2382 });
  });
});

describe("parseGeminiQuotas — legacy per-feature shape", () => {
  it("collects multiple features sorted by limit descending", () => {
    const { features } = parseGeminiQuotas([
      [
        [[null, 4], 1, 0, [1780679819, 0], 25, 20],
        [[null, 15], 1, 0, [1780679819, 0], 80, 75],
      ],
      "",
    ]);
    expect(features.map((f) => f.id)).toEqual([15, 4]);
    expect(features[0].name).toBe("Thinking");
    expect(features[1].name).toBe("Pro 3.1");
  });

  it("names unknown feature ids generically", () => {
    const { features } = parseGeminiQuotas([
      [[[null, 99], 1, 0, [1780679819, 0], 10, 5]],
      "",
    ]);
    expect(features[0].name).toBe("Feature 99");
  });
});

describe("parseGeminiQuotas — malformed input", () => {
  it("skips zero-limit, short, and non-numeric rows", () => {
    const { credits, features } = parseGeminiQuotas([
      [
        [[], 2, 0, [1780679819, 0], 0, 0],          // limit 0 → skip
        [[null, 4], 1, 0],                            // too short → skip
        [[null, 7], 1, 0, [1780679819, 0], "x", 5],  // non-numeric limit → skip
      ],
      "",
    ]);
    expect(credits).toBeNull();
    expect(features).toEqual([]);
  });

  it("returns a safe empty result for non-array payloads", () => {
    expect(parseGeminiQuotas(null)).toEqual({ credits: null, features: [] });
    expect(parseGeminiQuotas({})).toEqual({ credits: null, features: [] });
    expect(parseGeminiQuotas(["not-an-array"])).toEqual({ credits: null, features: [] });
  });

  it("leaves resetsAt null when the reset timestamp is missing", () => {
    const { credits } = parseGeminiQuotas([
      [[[], 2, 0, null, 100, 90]],
      "",
    ]);
    expect(credits).toMatchObject({ limit: 100, remaining: 90, used: 10, resetsAt: null });
  });
});
