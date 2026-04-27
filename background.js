"use strict";

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (msg.type === "badge") {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#7c83ff", tabId });
  }

  if (msg.type === "disabled") {
    chrome.action.setBadgeText({ text: "OFF", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#666", tabId });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-aleph" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "toggle" });
  }
});
