import type { Platform } from "../../shared/platform";
import { chatgptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { geminiAdapter } from "./gemini";
import type { TrackerPlatformAdapter } from "./types";

export { chatgptAdapter, claudeAdapter, geminiAdapter };
export type {
  MessageRole,
  MessageTrackingConfig,
  ModelCapsTrackingConfig,
  PlanTrackingConfig,
  ResponseTimingConfig,
  TrackerPlatformAdapter,
} from "./types";

export const TRACKER_ADAPTERS = {
  claude: claudeAdapter,
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
} satisfies Record<Platform, TrackerPlatformAdapter>;
