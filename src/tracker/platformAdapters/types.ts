import type { Platform } from "../../shared/platform";
import type { PlanDetection } from "../plans";

export type MessageRole = "assistant" | "user";

export interface MessageTrackingConfig {
  platform: Platform;
  messageWrappers: string[];
  assistantMarkers: string[];
  userMarkers: string[];
  editorClosestSelectors: string[];
  editorTextSelectors: string[];
  sendButtonContainerSelector: string;
}

export interface ResponseTimingConfig {
  platform: Platform;
  thinkingSelector: string;
  assistantSelector: string;
  hasFirstToken: (el: Element) => boolean;
}

export interface PlanTrackingConfig {
  bootstrap?: () => void;
  detect: () => PlanDetection | null;
}

export interface UsageTrackingConfig {
  poll: () => void;
}

export interface ModelCapsTrackingConfig {
  getCurrentModel?: () => string | null;
  poll?: () => void;
}

export interface TrackerPlatformAdapter {
  platform: Platform;
  messages: MessageTrackingConfig;
  timing?: ResponseTimingConfig;
  plan?: PlanTrackingConfig;
  usage?: UsageTrackingConfig;
  modelCaps?: ModelCapsTrackingConfig;
}
