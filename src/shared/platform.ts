export const PLATFORMS = ["claude", "chatgpt", "gemini"] as const;

export type Platform = typeof PLATFORMS[number];

export function detectPlatform(hostname: string): Platform | null {
  return hostname.includes("claude.ai") ? "claude" :
    hostname.includes("chatgpt.com") || hostname.includes("chat.openai.com") ? "chatgpt" :
    hostname.includes("gemini.google.com") ? "gemini" :
    null;
}

export type PlatformEnableKey = `enable${Capitalize<Platform>}`;
export type PlatformThemeKey = `theme${Capitalize<Platform>}`;

export function platformSettingSuffix(platform: Platform): Capitalize<Platform> {
  return (platform.charAt(0).toUpperCase() + platform.slice(1)) as Capitalize<Platform>;
}

export function platformEnableKey(platform: Platform): PlatformEnableKey {
  return `enable${platformSettingSuffix(platform)}`;
}

export function platformThemeKey(platform: Platform): PlatformThemeKey {
  return `theme${platformSettingSuffix(platform)}`;
}
