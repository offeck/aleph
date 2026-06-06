import { getSettings, isPlatformEnabled } from "./settingsStore";
import { getActiveThemeName } from "./theme";

export function updateBadge() {
  if (!chrome?.runtime?.sendMessage) return;
  if (!isPlatformEnabled()) {
    try { chrome.runtime.sendMessage({ type: "disabled" }); } catch (e) {}
    return;
  }
  const settings = getSettings();
  let count = 0;
  if (settings.bidiEnabled) count++;
  const themeName = getActiveThemeName();
  if (themeName !== "none") count++;
  if (settings.focusMode) count++;
  if (settings.streamSmooth) count++;
  if (settings.fontFamily || settings.codeFontFamily) count++;
  if (settings.chatWidth > 0) count++;
  if (settings.latexFix) count++;
  try { chrome.runtime.sendMessage({ type: "badge", count }); } catch (e) {}
}
