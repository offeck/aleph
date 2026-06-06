import { platformThemeKey } from "../shared/platform";
import { PLATFORM } from "./platform";
import { getSettings } from "./settingsStore";

export function getActiveThemeName() {
  const settings = getSettings();
  const platformKey = platformThemeKey(PLATFORM);
  return settings[platformKey] || settings.theme || "none";
}

export function isLightTheme(theme) {
  if (!theme) return null;
  const r = parseInt(theme.bg.slice(1, 3), 16);
  const g = parseInt(theme.bg.slice(3, 5), 16);
  const b = parseInt(theme.bg.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export function updateColorScheme(theme) {
  const scheme = theme ? (isLightTheme(theme) ? "light" : "dark") : null;
  let meta = document.querySelector('meta[name="color-scheme"][data-aleph]');
  if (scheme) {
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "color-scheme";
      meta.setAttribute("data-aleph", "true");
      document.head.appendChild(meta);
    }
    meta.content = scheme;
    document.documentElement.style.colorScheme = scheme;
  } else if (meta) {
    meta.remove();
    document.documentElement.style.removeProperty("color-scheme");
  }
}
