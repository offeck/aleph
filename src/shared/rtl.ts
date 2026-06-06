// RTL script letters only. Digits, punctuation, and standalone marks should
// not force text into RTL.
export const RTL_SCRIPT_LETTER_RE = /(?=[\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/u;
export const RTL_SCRIPT_LETTER_RE_G = /(?=[\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/gu;

export function hasRTLScriptLetter(text: string): boolean {
  return RTL_SCRIPT_LETTER_RE.test(text || "");
}

export function countRTLScriptLetters(text: string): number {
  RTL_SCRIPT_LETTER_RE_G.lastIndex = 0;
  return (text.match(RTL_SCRIPT_LETTER_RE_G) || []).length;
}
