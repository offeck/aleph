import type { Platform } from "./platform";

// Message field lists describe what senders actually put on the wire today
// (tracker/content) and what the background router reads — they must never
// be used to change wire shapes (MIGRATION rule: types describe, not change).

export interface InsightsMessagePayload {
  type: "insights-message";
  platform: string;
  role: string;
  estimatedTokens?: number;
  estimatedTextTokens?: number;
  estimatedImageTokens?: number;
  estimatedFileTokens?: number;
  /** Legacy field names the router still accepts. */
  textTokens?: number;
  imageTokens?: number;
  fileTokens?: number;
  imageCount?: number;
  fileCount?: number;
  estimateSource?: string;
  model?: string | null;
  timestamp?: number;
  isUpdate?: boolean;
  tokenDelta?: number;
  textTokenDelta?: number;
  imageTokenDelta?: number;
  fileTokenDelta?: number;
  imageCountDelta?: number;
  fileCountDelta?: number;
}

export type ContentToBackgroundMessage =
  | { type: "disabled"; platform: Platform }
  | { type: "badge"; count: number }
  | { type: "insights-time"; platform: string; seconds: number; hour: number }
  | { type: "insights-send-analytics"; platform: string; lang?: string; length?: number; words?: number; timestamp?: number }
  | { type: "insights-response-timing"; platform: string; sendToThinking?: number; thinkingToFirstToken?: number; totalTTFT?: number; timestamp?: number }
  | InsightsMessagePayload
  | { type: "insights-subscription"; platform: string; plan?: string; price?: number; label?: string; model?: string | null }
  | { type: "insights-model-caps"; platform: string; caps?: Record<string, unknown> }
  // Provider usage snapshots are raw provider JSON — boundary `any` values.
  | { type: "insights-usage"; platform: string; usage?: Record<string, any> };

export type PageToBackgroundMessage =
  | { type: "insights-get-summary" }
  | { type: "aleph-sync-status" }
  | { type: "aleph-sync-signin" }
  | { type: "aleph-sync-signout" }
  | { type: "aleph-sync-now" };

export type BackgroundToContentMessage = { type: "toggle" };

export type ExternalMessage = { type: "aleph-reload" };

export type AlephMessage =
  | ContentToBackgroundMessage
  | PageToBackgroundMessage
  | BackgroundToContentMessage
  | ExternalMessage;

export interface StoredRemark {
  text: string;
  category: string;
  generatedAt: number;
}

// Response shape of the background `insights-get-summary` handler. The leaf
// values are raw storage JSON (usage_ docs, provider snapshots, stored
// subscriptions) — boundary `any` records read defensively by popup/insights.
export interface InsightsSummary {
  subs: Record<string, any>;
  today: Record<string, any>;
  remark: StoredRemark | null;
  weekData: Record<string, any>;
  prevWeekData: Record<string, any>;
  platformUsage: Record<string, any>;
  modelCaps: Record<string, any>;
}
