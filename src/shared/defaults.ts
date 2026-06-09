export const DEFAULTS = {
  bidiEnabled: true,
  enableClaude: true,
  enableChatgpt: true,
  enableGemini: true,
  fontFamily: "",
  fontSize: 0,
  lineHeight: 0,
  paragraphSpacing: 0,
  codeFontSize: 0,
  codeFontFamily: "",
  chatWidth: 0,
  theme: "none",
  themeClaude: "",
  themeChatgpt: "",
  themeGemini: "",
  focusMode: false,
  focusHideUpgrade: true,
  focusHideChips: true,
  focusHidePromos: true,
  latexFix: true,
  streamSmooth: true,
  streamAnimation: "platform",
  messageSpacing: 0,
  miniGame: false,
};

export type Settings = typeof DEFAULTS;

// Keeps only keys defined in DEFAULTS — the shared guard for settings that
// cross a trust boundary (file import, cloud sync).
export function filterToDefaults(data: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (key in data) filtered[key] = data[key];
  }
  return filtered;
}
