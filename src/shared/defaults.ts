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
  // Window Primer — opt-in scheduled/smart usage-window warm-up.
  primerEnabled: false,
  primerMode: "scheduled" as "scheduled" | "smart",
  primerTimes: [] as string[],
  primerOffDays: [] as number[],          // JS getDay(): 0=Sun … 6=Sat
  primerActiveHoursEnabled: false,
  primerActiveStart: "07:00",
  primerActiveEnd: "23:00",
  primerTargetClaude: true,
  primerTargetCodex: true,
  primerAutoDeleteClaude: true,
  primerJitterEnabled: true,
  primerJitterSeconds: 120,               // random 0..N s added to every fire; N clamped 0..120
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
