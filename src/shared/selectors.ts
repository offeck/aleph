import type { Platform } from "./platform";

export interface FocusHideSelectors {
  upgrade: string[];
  chips: string[];
  promos: string[];
}

export interface SelectorSet {
  text: string[];
  editor: string[];
  math: string[];
  code: string[];
  message: string[];
  chatWidth: string[];
  themeBg: string[];
  themeText: string[];
  themeInput: string[];
  themeCode: string[];
  themeSidebar: string[];
  focusHide: FocusHideSelectors;
  streaming: string[];
  messageWrapper: string[];
  chatContainer: string[];
}

export const SELECTORS: Record<Platform, SelectorSet> = {
  claude: {
    text: [
      ".font-claude-response-body",
      ".standard-markdown p", ".standard-markdown li",
      ".standard-markdown h1", ".standard-markdown h2",
      ".standard-markdown h3", ".standard-markdown h4",
      ".standard-markdown blockquote",
      ".progressive-markdown p", ".progressive-markdown li",
      ".progressive-markdown h1", ".progressive-markdown h2",
      ".progressive-markdown h3", ".progressive-markdown h4",
      ".font-claude-response p", ".font-claude-response li",
      ".whitespace-pre-wrap"
    ],
    editor: [".ProseMirror"],
    math: [".katex", ".katex-display", ".katex-html", ".katex-mathml", "mjx-container"],
    code: [".code-block__code", "pre code", ".code-block"],
    message: [".font-claude-response", "[data-testid='chat-message-content']"],
    chatWidth: [".mx-auto.w-full"],
    themeBg: ["body", "main", ".bg-bg-000", ".bg-bg-100", ".bg-bg-200"],
    themeText: [".font-claude-response", ".font-claude-response-body", "p", "li", "h1", "h2", "h3", "h4"],
    themeInput: [".ProseMirror", "[data-testid='composer']", ".bg-bg-000"],
    themeCode: [".code-block", ".code-block__code", "pre"],
    themeSidebar: ["nav", ".bg-bg-100"],
    focusHide: {
      upgrade: [
        "[data-testid='nav-upgrade']",
        "[data-testid='upgrade-button']",
        ".bg-accent-main-000[class*='upgrade']",
        "[href='/settings/billing']",
      ],
      chips: [],
      promos: [],
    },
    streaming: [".progressive-markdown", ".font-claude-response"],
    messageWrapper: ["[data-testid='chat-message']", ".mb-1\\.5"],
    chatContainer: ["main", "[data-testid='chat-messages']"],
  },
  chatgpt: {
    text: [
      ".markdown p", ".markdown li",
      ".markdown h1", ".markdown h2", ".markdown h3", ".markdown h4",
      ".markdown blockquote",
      ".prose p", ".prose li",
      "[data-message-author-role='assistant'] p",
      "[data-message-author-role='assistant'] li"
    ],
    editor: ["#prompt-textarea", "[contenteditable='true']"],
    math: [".katex", ".katex-display", ".katex-html", ".katex-mathml", "mjx-container", ".math-inline", ".math-display"],
    code: ["code.hljs", "pre code", ".code-block__code"],
    message: [".markdown", "[data-message-author-role='assistant']"],
    chatWidth: ["main .group\\/thread", "main [class*='thread-content']", "main .max-w-3xl"],
    themeBg: ["body", "main", ".bg-token-bg-primary", ".bg-token-main-surface-primary", ".bg-token-bg-tertiary"],
    themeText: [".markdown", ".prose", "p", "li", "h1", "h2", "h3", "h4"],
    themeInput: ["#prompt-textarea", ".bg-token-bg-primary", "[contenteditable='true']"],
    themeCode: ["pre", "code.hljs", ".bg-token-bg-tertiary"],
    themeSidebar: ["nav", "[class*='sidebar'][class*='shrink']", ".bg-\\(--sidebar-surface-primary\\)"],
    focusHide: {
      upgrade: [
        "[data-testid='upgrade-button']",
        "[class*='upgrade']",
      ],
      chips: [],
      promos: [
        "a[href='/gpts']",
        ".juice\\:hidden",
        "header .pointer-events-none:has(.rounded-full)",
      ],
    },
    streaming: [".result-streaming", ".markdown"],
    messageWrapper: ["[data-testid^='conversation-turn']", ".group\\/conversation-turn"],
    chatContainer: ["main", ".group\\/thread", "[class*='thread-content']"],
  },
  gemini: {
    text: [
      ".response-content p", ".response-content li",
      ".response-content h1", ".response-content h2",
      ".response-content h3", ".response-content h4",
      ".response-content blockquote",
      ".markdown p", ".markdown li",
      ".model-response-text p", ".model-response-text li",
      "message-content p", "message-content li"
    ],
    editor: [".ql-editor", "rich-textarea .ql-editor", "[contenteditable='true']"],
    math: [".katex", ".katex-display", ".katex-html", ".katex-mathml", "mjx-container"],
    code: ["code-block", "pre code", ".code-container"],
    message: [".response-content", ".model-response-text", "message-content"],
    chatWidth: [".conversation-container"],
    themeBg: ["body", "main", ".chat-container", "chat-app", ".conversation-container", ".response-container"],
    themeText: [".response-content", ".model-response-text", "message-content", "p", "li", ".query-content", ".conversation-title"],
    themeInput: [".ql-editor", "rich-textarea", "[contenteditable='true']", ".text-input-field_textarea", "input-area-v2"],
    themeCode: ["code-block", "pre", ".code-container"],
    themeSidebar: ["nav", "side-navigation-v2", "side-navigation-content", ".side-navigation-content", "bard-sidenav", "bard-sidenav-container"],
    focusHide: {
      upgrade: ["[class*='upgrade']"],
      chips: ["intent-card", ".card-container", ".suggestion-chip", ".chip-container"],
      promos: ["[class*='promo']"],
    },
    streaming: [".response-content", ".model-response-text", "model-response"],
    messageWrapper: ["model-response", ".conversation-turn", ".conversation-container > *"],
    chatContainer: [".conversation-container", "chat-app"],
  },
};

export const TEXT_SELECTOR_UNION = [
  ...SELECTORS.claude.text,
  ...SELECTORS.chatgpt.text,
  ...SELECTORS.gemini.text,
].join(", ");

export const MESSAGE_WRAPPER_SELECTOR_UNION = [
  ...SELECTORS.claude.messageWrapper,
  ".font-claude-response",
  "[data-testid='user-message']",
  ...SELECTORS.chatgpt.messageWrapper,
  ...SELECTORS.gemini.messageWrapper,
  ".query-content",
  "message-content",
].join(", ");
