import type { Platform } from "./platform";

type AnyRecord = Record<string, unknown>;

export type ContentToBackgroundMessage =
  | { type: "disabled"; platform: Platform }
  | { type: "badge"; count: number }
  | ({ type: "insights-time" } & AnyRecord)
  | ({ type: "insights-send-analytics" } & AnyRecord)
  | ({ type: "insights-response-timing" } & AnyRecord)
  | ({ type: "insights-message" } & AnyRecord)
  | ({ type: "insights-subscription" } & AnyRecord)
  | ({ type: "insights-model-caps" } & AnyRecord)
  | ({ type: "insights-usage" } & AnyRecord);

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
