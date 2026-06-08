// Deliberately the legacy cross-platform union: every adapter shares these so
// the refactor preserves the exact pre-refactor editor-matching behavior (the
// old EDITOR_SEL was platform-agnostic). An adapter therefore lists selectors
// that don't exist on its platform (e.g. Claude carrying .ql-editor) — a
// harmless no-op match, kept for behavioral equivalence rather than trimmed.
export const DEFAULT_EDITOR_CLOSEST_SELECTORS = [
  "[contenteditable]",
  "textarea",
  "#prompt-textarea",
  ".ProseMirror",
  ".ql-editor",
  "rich-textarea",
];

export const DEFAULT_EDITOR_TEXT_SELECTORS = [
  ".ProseMirror",
  "#prompt-textarea",
  ".ql-editor",
];

export const DEFAULT_SEND_BUTTON_CONTAINER_SELECTOR =
  "form, fieldset, [class*='composer'], [class*='input-container'], [class*='chat-input']";

export function hasParagraphTextLongerThan(el: Element, threshold: number) {
  const p = el.querySelector("p");
  return p ? p.textContent.trim().length > threshold : false;
}
