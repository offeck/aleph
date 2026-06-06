import { describe, expect, it } from "vitest";
import { localDateString, usageKeyForDate } from "../../src/shared/dates";
import { formatTime, formatTokens } from "../../src/shared/format";
import {
  PLATFORMS,
  detectPlatform,
  platformEnableKey,
  platformSettingSuffix,
  platformThemeKey,
} from "../../src/shared/platform";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "../../src/shared/platformMeta";
import { PRICING } from "../../src/shared/pricing";
import { countRTLScriptLetters, hasRTLScriptLetter } from "../../src/shared/rtl";
import {
  MESSAGE_WRAPPER_SELECTOR_UNION,
  SELECTORS,
  TEXT_SELECTOR_UNION,
} from "../../src/shared/selectors";

describe("shared date and format helpers", () => {
  it("formats local usage keys without timezone conversion", () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(usageKeyForDate(new Date(2026, 10, 9))).toBe("usage_2026-11-09");
  });

  it("formats compact time and token values", () => {
    expect(formatTime(0)).toBe("0m");
    expect(formatTime(59)).toBe("59s");
    expect(formatTime(60)).toBe("1m");
    expect(formatTime(3660)).toBe("1h 1m");
    expect(formatTokens(0)).toBe("~0");
    expect(formatTokens(999)).toBe("~999");
    expect(formatTokens(1500)).toBe("~1.5K");
  });
});

describe("shared platform helpers", () => {
  it("detects supported hostnames", () => {
    expect(PLATFORMS).toEqual(["claude", "chatgpt", "gemini"]);
    expect(detectPlatform("claude.ai")).toBe("claude");
    expect(detectPlatform("chatgpt.com")).toBe("chatgpt");
    expect(detectPlatform("chat.openai.com")).toBe("chatgpt");
    expect(detectPlatform("gemini.google.com")).toBe("gemini");
    expect(detectPlatform("example.com")).toBeNull();
  });

  it("builds settings keys from platform ids", () => {
    expect(platformSettingSuffix("chatgpt")).toBe("Chatgpt");
    expect(platformEnableKey("gemini")).toBe("enableGemini");
    expect(platformThemeKey("claude")).toBe("themeClaude");
  });
});

describe("shared RTL helpers", () => {
  it("detects only Hebrew and Arabic-script letters", () => {
    expect(hasRTLScriptLetter("hello 123")).toBe(false);
    expect(hasRTLScriptLetter("שלום")).toBe(true);
    expect(hasRTLScriptLetter("مرحبا")).toBe(true);
    expect(countRTLScriptLetters("abc שלום مرحبا")).toBe(9);
  });
});

describe("shared platform metadata and pricing", () => {
  it("keeps platform metadata aligned with supported platforms", () => {
    expect(Object.keys(PLATFORM_LABELS)).toEqual([...PLATFORMS]);
    expect(Object.keys(PLATFORM_COLORS)).toEqual([...PLATFORMS]);
    expect(PLATFORM_LABELS.claude).toBe("Claude");
    expect(PLATFORM_COLORS.chatgpt).toBe("#4285F4");
    expect(PRICING.chatgpt.plus.price).toBe(20);
  });
});

describe("shared selectors", () => {
  it("exports selector unions used by regression snippets", () => {
    expect(SELECTORS.claude.text).toContain(".font-claude-response-body");
    expect(TEXT_SELECTOR_UNION).toContain("[data-message-author-role='assistant'] p");
    expect(MESSAGE_WRAPPER_SELECTOR_UNION).toContain("[data-testid='user-message']");
    expect(MESSAGE_WRAPPER_SELECTOR_UNION).toContain("message-content");
  });
});
