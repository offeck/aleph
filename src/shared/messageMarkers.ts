import type { Platform } from "./platform";

// Single source for user-message markers — consumed by the tracker
// (per-platform arrays for message classification) and the mini-game spawn
// latch (flat union for its cycle-boundary count). User bubbles render
// synchronously at send time on all three platforms.
export const USER_MESSAGE_MARKERS: Record<Platform, string[]> = {
  claude: ["[data-testid='user-message']"],
  chatgpt: ["[data-message-author-role='user']"],
  gemini: [".query-content", ".user-query"],
};

export const USER_MESSAGE_SEL = Object.values(USER_MESSAGE_MARKERS).flat().join(", ");
