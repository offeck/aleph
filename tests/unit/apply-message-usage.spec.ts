import { describe, expect, it } from "vitest";
import { applyMessageUsage, emptyPlatformDay } from "../../src/background/usage";
import type { InsightsMessagePayload } from "../../src/shared/messages";

function msg(over: Partial<InsightsMessagePayload>): InsightsMessagePayload {
  return { type: "insights-message", platform: "claude", role: "user", ...over };
}

describe("applyMessageUsage", () => {
  it("user non-update increments messageCount and feeds tokensIn", () => {
    const day = emptyPlatformDay();
    applyMessageUsage(day, msg({ estimatedTokens: 50, estimatedTextTokens: 50 }), "user");
    expect(day.messageCount).toBe(1);
    expect(day.tokensIn).toBe(50);
    expect(day.textTokensIn).toBe(50);
    expect(day.tokensOut).toBe(0);
    expect(day.estimateSource).toBe("local");
  });

  it("assistant non-update does NOT increment messageCount but feeds tokensOut", () => {
    const day = emptyPlatformDay();
    applyMessageUsage(day, msg({ role: "assistant", estimatedTokens: 200, estimatedTextTokens: 200 }), "assistant");
    expect(day.messageCount).toBe(0);
    expect(day.tokensOut).toBe(200);
    expect(day.textTokensOut).toBe(200);
    expect(day.tokensIn).toBe(0);
  });

  it("user update adjusts tokensIn delta without incrementing messageCount", () => {
    const day = emptyPlatformDay();
    day.tokensIn = 10;
    applyMessageUsage(day, msg({ isUpdate: true, tokenDelta: 7, textTokenDelta: 7 }), "user");
    expect(day.messageCount).toBe(0);
    expect(day.tokensIn).toBe(17);
    expect(day.textTokensIn).toBe(7);
  });

  it("assistant update adjusts tokensOut delta without incrementing messageCount", () => {
    const day = emptyPlatformDay();
    day.tokensOut = 100;
    applyMessageUsage(day, msg({ role: "assistant", isUpdate: true, tokenDelta: 25 }), "assistant");
    expect(day.messageCount).toBe(0);
    expect(day.tokensOut).toBe(125);
  });

  it("counts each user send (additive across calls)", () => {
    const day = emptyPlatformDay();
    applyMessageUsage(day, msg({ estimatedTokens: 10 }), "user");
    applyMessageUsage(day, msg({ estimatedTokens: 20 }), "user");
    expect(day.messageCount).toBe(2);
    expect(day.tokensIn).toBe(30);
  });

  it("routes image/file counts to the role's In/Out suffix", () => {
    const userDay = emptyPlatformDay();
    applyMessageUsage(userDay, msg({ imageCount: 2, fileCount: 1, estimatedImageTokens: 500, estimatedFileTokens: 300 }), "user");
    expect(userDay.imageCountIn).toBe(2);
    expect(userDay.fileCountIn).toBe(1);
    expect(userDay.imageTokensIn).toBe(500);
    expect(userDay.fileTokensIn).toBe(300);
    expect(userDay.imageCountOut).toBe(0);

    const asstDay = emptyPlatformDay();
    applyMessageUsage(asstDay, msg({ role: "assistant", imageCount: 3, fileCount: 4 }), "assistant");
    expect(asstDay.imageCountOut).toBe(3);
    expect(asstDay.fileCountOut).toBe(4);
    expect(asstDay.imageCountIn).toBe(0);
  });

  it("clamps a negative update delta at zero", () => {
    const day = emptyPlatformDay();
    day.tokensIn = 5;
    applyMessageUsage(day, msg({ isUpdate: true, tokenDelta: -20 }), "user");
    expect(day.tokensIn).toBe(0);
    expect(day.messageCount).toBe(0);
  });
});
