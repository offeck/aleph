import { USER_MESSAGE_MARKERS } from "../../shared/messageMarkers";
import {
  DEFAULT_EDITOR_CLOSEST_SELECTORS,
  DEFAULT_EDITOR_TEXT_SELECTORS,
  DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR,
  hasParagraphTextLongerThan,
} from "./common";
import { detectClaudeSubscription, detectClaudeViaApi } from "../plans";
import { pollClaudeModelCapabilities } from "../modelCaps";
import { pollClaudeUsage } from "../usageClaude";
import type { TrackerPlatformAdapter } from "./types";

export const claudeAdapter: TrackerPlatformAdapter = {
  platform: "claude",
  messages: {
    platform: "claude",
    messageWrappers: ["[data-testid='user-message']", ".font-claude-response"],
    assistantMarkers: [".font-claude-response"],
    userMarkers: USER_MESSAGE_MARKERS.claude,
    editorClosestSelectors: DEFAULT_EDITOR_CLOSEST_SELECTORS,
    editorTextSelectors: DEFAULT_EDITOR_TEXT_SELECTORS,
    sendButtonContainerSelector: DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR,
  },
  timing: {
    platform: "claude",
    thinkingSelector: '[aria-label="Stop response"]',
    assistantSelector: ".font-claude-response",
    hasFirstToken: (el) => hasParagraphTextLongerThan(el, 5),
  },
  plan: {
    bootstrap: detectClaudeViaApi,
    detect: detectClaudeSubscription,
  },
  usage: {
    poll: pollClaudeUsage,
  },
  modelCaps: {
    poll: pollClaudeModelCapabilities,
  },
};
