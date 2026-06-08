import { USER_MESSAGE_MARKERS } from "../../shared/messageMarkers";
import {
  DEFAULT_EDITOR_CLOSEST_SELECTORS,
  DEFAULT_EDITOR_TEXT_SELECTORS,
  DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR,
  hasParagraphTextLongerThan,
} from "./common";
import { detectGeminiSubscription } from "../plans";
import type { TrackerPlatformAdapter } from "./types";

export const geminiAdapter: TrackerPlatformAdapter = {
  platform: "gemini",
  messages: {
    platform: "gemini",
    messageWrappers: ["model-response", ".conversation-turn", ".query-content"],
    assistantMarkers: [".response-content", ".model-response-text", "message-content"],
    userMarkers: USER_MESSAGE_MARKERS.gemini,
    editorClosestSelectors: DEFAULT_EDITOR_CLOSEST_SELECTORS,
    editorTextSelectors: DEFAULT_EDITOR_TEXT_SELECTORS,
    sendButtonContainerSelector: DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR,
  },
  timing: {
    platform: "gemini",
    thinkingSelector: ".send-button.stop",
    assistantSelector: ".response-content",
    hasFirstToken: (el) => hasParagraphTextLongerThan(el, 10),
  },
  plan: {
    detect: detectGeminiSubscription,
  },
};
