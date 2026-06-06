export const PLATFORMS = ["claude", "chatgpt", "gemini"] as const;

export type Platform = typeof PLATFORMS[number];

export function detectPlatform(hostname: string): Platform | null {
  return hostname.includes("claude.ai") ? "claude" :
    hostname.includes("chatgpt.com") || hostname.includes("chat.openai.com") ? "chatgpt" :
    hostname.includes("gemini.google.com") ? "gemini" :
    null;
}

export function platformSettingSuffix(platform: Platform): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function platformEnableKey(platform: Platform): string {
  return "enable" + platformSettingSuffix(platform);
}

export function platformThemeKey(platform: Platform): string {
  return "theme" + platformSettingSuffix(platform);
}
