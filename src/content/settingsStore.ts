import { DEFAULTS, type Settings } from "../shared/defaults";
import { platformEnableKey } from "../shared/platform";
import { PLATFORM } from "./platform";

// Single owner of the mutable settings object. The object identity is stable
// (mutated in place, never reassigned) so every module's reads through
// getSettings() observe live updates from loadSettings()/applySettingsChange().
const settings: Settings = { ...DEFAULTS };

export function getSettings(): Settings {
  return settings;
}

export function applySettingsChange(key: string, value: unknown) {
  (settings as Record<string, unknown>)[key] = value;
}

export function loadSettings() {
  return new Promise<void>((resolve) => {
    if (chrome?.storage?.sync) {
      chrome.storage.sync.get(DEFAULTS, (s) => {
        Object.assign(settings, DEFAULTS, s);
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function isPlatformEnabled() {
  // No platform (node / unmatched host): nothing is disabled — mirrors the
  // pre-split behavior where the lookup key simply missed every setting.
  if (!PLATFORM) return true;
  const key = platformEnableKey(PLATFORM);
  return settings[key] !== false;
}
