export function send(msg) {
  try { chrome.runtime.sendMessage(msg); } catch (e) {}
}
