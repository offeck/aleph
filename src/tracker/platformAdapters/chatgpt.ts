import { USER_MESSAGE_MARKERS } from "../../shared/messageMarkers";
import {
  DEFAULT_EDITOR_CLOSEST_SELECTORS,
  DEFAULT_EDITOR_TEXT_SELECTORS,
  DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR,
} from "./common";
import { detectChatgptSubscription, detectChatgptViaApi } from "../plans";
import { getChatgptCurrentModel, pollChatgptModelCapabilities } from "../modelCaps";
import type { TrackerPlatformAdapter } from "./types";

function hasChatgptFirstToken(el: Element) {
  const markdowns = el.querySelectorAll(".markdown");
  const lastMd = markdowns.length ? markdowns[markdowns.length - 1] : null;
  const p = lastMd ? lastMd.querySelector("p") : null;
  return p ? p.textContent.trim().length > 20 : false;
}

export const chatgptAdapter: TrackerPlatformAdapter = {
  platform: "chatgpt",
  messages: {
    platform: "chatgpt",
    messageWrappers: ["[data-testid^='conversation-turn']"],
    assistantMarkers: ["[data-message-author-role='assistant']"],
    userMarkers: USER_MESSAGE_MARKERS.chatgpt,
    editorClosestSelectors: DEFAULT_EDITOR_CLOSEST_SELECTORS,
    editorTextSelectors: DEFAULT_EDITOR_TEXT_SELECTORS,
    sendButtonContainerSelector: DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR,
  },
  timing: {
    platform: "chatgpt",
    thinkingSelector: '[aria-label="Stop streaming"], [aria-label*="Stop" i]',
    assistantSelector: '[data-message-author-role="assistant"]',
    hasFirstToken: hasChatgptFirstToken,
  },
  plan: {
    bootstrap: detectChatgptViaApi,
    detect: detectChatgptSubscription,
  },
  modelCaps: {
    getCurrentModel: getChatgptCurrentModel,
    poll: pollChatgptModelCapabilities,
  },
};
