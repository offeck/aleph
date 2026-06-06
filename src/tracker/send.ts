export interface TrackerMessage {
  type: string;
  [field: string]: unknown;
}

export function send(msg: TrackerMessage) {
  try { chrome.runtime.sendMessage(msg); } catch (e) {}
}
