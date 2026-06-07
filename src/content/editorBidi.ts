import { RTL_SCRIPT_LETTER_RE } from "../shared/rtl";

// ── Composer BiDi helpers (pure — unit-tested, no chrome/DOM access) ───
// Aleph never writes into host-editor subtrees (ProseMirror/Quill reconcile
// them and revert foreign attributes — the c7bb26f composer feedback loop).
// Instead, blocks are styled from an Aleph-owned stylesheet via structural
// selectors: a scope attribute on a non-managed ancestor + an :nth-child
// path from the editor root to each RTL block (so nested blocks like
// ul > li keep per-block direction, matching the old per-descendant writes).

// Scope attribute set on the nearest non-contenteditable ancestor of each
// editor. Attribute mutations are invisible to the content body observer
// (childList/characterData only), so writing it cannot re-trigger passes.
export const SCOPE_ATTR = "data-aleph-editor-bidi";

// Any letter outside Aleph's RTL scripts counts as strong LTR — mirrors
// dir="auto" first-strong resolution for the scripts Aleph distinguishes
// (Greek, Cyrillic, Latin-extended, CJK all resolve LTR, like native).
const LTR_LETTER_RE = /(?![\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/u;

// First-strong direction, mirroring dir="auto" semantics: digits,
// punctuation, and spaces are weak; the first strong letter decides.
export function blockDir(text: string | null | undefined): "rtl" | "ltr" | null {
  if (!text) return null;
  for (const ch of text) {
    if (RTL_SCRIPT_LETTER_RE.test(ch)) return "rtl";
    if (LTR_LETTER_RE.test(ch)) return "ltr";
  }
  return null;
}

export interface EditorScopeBlocks {
  id: string;
  // 1-based :nth-child paths from the editor root down to each RTL block
  // (last segment is the block itself).
  rtlPaths: number[][];
}

// Only RTL blocks get rules: LTR/empty blocks keep the host default, and the
// static `unicode-bidi: plaintext` rule in styles/bidi.css already handles
// reordering. Output is deterministic for the string-compare write guard.
export function buildEditorBidiCss(scopes: EditorScopeBlocks[]): string {
  let css = "";
  for (const scope of scopes) {
    for (const path of scope.rtlPaths) {
      if (path.length === 0) continue;
      const inner = path.slice(0, -1).map((n) => ` > :nth-child(${n})`).join("");
      const leaf = ` > :is(p, div, li):nth-child(${path[path.length - 1]})`;
      css += `[${SCOPE_ATTR}="${scope.id}"] [contenteditable="true"]${inner}${leaf} {
  direction: rtl !important;
  text-align: right !important;
}
`;
    }
  }
  return css;
}
