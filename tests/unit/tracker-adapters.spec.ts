import { describe, expect, it } from "vitest";
import { PLATFORMS } from "../../src/shared/platform";
import { classifyMessage } from "../../src/tracker/messages";
import { TRACKER_ADAPTERS } from "../../src/tracker/platformAdapters";

function fakeElement(options: {
  text?: string;
  matches?: string[];
  query?: Record<string, Element | null>;
  queryAll?: Record<string, Element[]>;
} = {}) {
  return {
    textContent: options.text || "",
    matches: (sel: string) => Boolean(options.matches?.includes(sel)),
    querySelector: (sel: string) => options.query?.[sel] || null,
    querySelectorAll: (sel: string) => options.queryAll?.[sel] || [],
  } as unknown as Element;
}

describe("tracker platform adapters", () => {
  it("covers every supported platform", () => {
    expect(Object.keys(TRACKER_ADAPTERS)).toEqual([...PLATFORMS]);
  });

  it("defines complete message tracking config for every platform", () => {
    for (const platform of PLATFORMS) {
      const config = TRACKER_ADAPTERS[platform].messages;
      expect(config.platform).toBe(platform);
      expect(config.messageWrappers.length).toBeGreaterThan(0);
      expect(config.assistantMarkers.length).toBeGreaterThan(0);
      expect(config.userMarkers.length).toBeGreaterThan(0);
      expect(config.editorClosestSelectors.length).toBeGreaterThan(0);
      expect(config.editorTextSelectors.length).toBeGreaterThan(0);
      expect(config.sendButtonContainerSelector.length).toBeGreaterThan(0);
    }
  });

  it("does not run provider usage polling from content-script adapters", () => {
    for (const platform of PLATFORMS) {
      expect("usage" in TRACKER_ADAPTERS[platform]).toBe(false);
    }
  });

  it("classifies messages using adapter markers", () => {
    expect(classifyMessage(
      fakeElement({ matches: [".font-claude-response"] }),
      TRACKER_ADAPTERS.claude.messages,
    )).toBe("assistant");

    expect(classifyMessage(
      fakeElement({ query: { "[data-message-author-role='user']": fakeElement() } }),
      TRACKER_ADAPTERS.chatgpt.messages,
    )).toBe("user");
  });

  it("keeps response timing first-token thresholds platform-specific", () => {
    const claude = TRACKER_ADAPTERS.claude.timing;
    const chatgpt = TRACKER_ADAPTERS.chatgpt.timing;
    const gemini = TRACKER_ADAPTERS.gemini.timing;
    if (!claude || !chatgpt || !gemini) throw new Error("missing timing adapter");

    expect(claude.hasFirstToken(fakeElement({ query: { p: fakeElement({ text: "12345" }) } }))).toBe(false);
    expect(claude.hasFirstToken(fakeElement({ query: { p: fakeElement({ text: "123456" }) } }))).toBe(true);

    const shortMarkdown = fakeElement({ query: { p: fakeElement({ text: "12345678901234567890" }) } });
    const longMarkdown = fakeElement({ query: { p: fakeElement({ text: "123456789012345678901" }) } });
    expect(chatgpt.hasFirstToken(fakeElement({ queryAll: { ".markdown": [shortMarkdown] } }))).toBe(false);
    expect(chatgpt.hasFirstToken(fakeElement({ queryAll: { ".markdown": [shortMarkdown, longMarkdown] } }))).toBe(true);

    expect(gemini.hasFirstToken(fakeElement({ query: { p: fakeElement({ text: "1234567890" }) } }))).toBe(false);
    expect(gemini.hasFirstToken(fakeElement({ query: { p: fakeElement({ text: "12345678901" }) } }))).toBe(true);
  });
});
