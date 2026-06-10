import { describe, expect, it } from "vitest";
import {
  extractAntigravityProjectId,
  normalizeAntigravityUsage,
} from "../../src/tracker/usageAntigravity";

describe("normalizeAntigravityUsage", () => {
  it("normalizes prompt credits and model quota fractions from Cloud Code", () => {
    const snapshot = normalizeAntigravityUsage({
      planInfo: { monthlyPromptCredits: 500, planType: "premium" },
      availablePromptCredits: 450,
      cloudaicompanionProject: { id: "project-1" },
    }, {
      models: {
        "gemini-3-pro-low": {
          displayName: "Gemini 3 Pro",
          quotaInfo: {
            remainingFraction: 0.75,
            resetTime: "2026-06-10T12:00:00.000Z",
            isExhausted: false,
          },
        },
        "claude-sonnet-4-5": {
          displayName: "Claude Sonnet 4.5",
          quotaInfo: { remainingFraction: 0.25 },
        },
      },
    })!;

    expect(snapshot).toMatchObject({
      source: "provider",
      planType: "premium",
      project: "project-1",
      credits: {
        limit: 500,
        remaining: 450,
        used: 50,
        remainingPct: 90,
        usedPct: 10,
      },
    });
    expect(snapshot.models).toEqual([
      expect.objectContaining({
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        limit: 100,
        remaining: 25,
        used: 75,
        remainingPct: 25,
        usedPct: 75,
      }),
      expect.objectContaining({
        id: "gemini-3-pro-low",
        name: "Gemini 3 Pro",
        remaining: 75,
        used: 25,
        resetsAt: "2026-06-10T12:00:00.000Z",
      }),
    ]);
  });

  it("filters internal/non-quota model rows and accepts percent-shaped fractions", () => {
    const snapshot = normalizeAntigravityUsage({}, {
      models: {
        chat_internal: { displayName: "Internal", quotaInfo: { remainingFraction: 0 } },
        "image-model": { displayName: "Image", quotaInfo: { remainingFraction: 0 } },
        "gpt-oss": { label: "GPT OSS", quotaInfo: { remainingFraction: 80 } },
        "no-quota": { displayName: "No quota" },
      },
    })!;

    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0]).toMatchObject({
      id: "gpt-oss",
      remaining: 80,
      used: 20,
    });
  });

  it("returns null when there is no quota data", () => {
    expect(normalizeAntigravityUsage({ planInfo: { planType: "free" } }, { models: {} })).toBeNull();
    expect(normalizeAntigravityUsage(null, null)).toBeNull();
  });
});

describe("extractAntigravityProjectId", () => {
  it("handles string and object project id shapes", () => {
    expect(extractAntigravityProjectId({ cloudaicompanionProject: "project-a" })).toBe("project-a");
    expect(extractAntigravityProjectId({ cloudaicompanionProject: { id: "project-b" } })).toBe("project-b");
    expect(extractAntigravityProjectId({})).toBeNull();
  });
});
