import { PLATFORM } from "./platform";
import { SEL } from "./selectors";
import { getSettings } from "./settingsStore";
import { hasRTLScriptText } from "./bidi";
import { collectCandidates, makeTextGate, notifyPending, textOf } from "./rescan";

// Vendored global (vendor/katex/katex.min.js, loaded as a sibling content
// script) — no type definitions shipped; the only non-boundary `any` allowed.
declare const katex: any;

// ── LaTeX Fixer ────────────────────────────────────────────────────────
export const LATEX_CMD_RE = /\\(?:frac|int|iint|iiint|oint|sum|prod|coprod|sqrt|leq|geq|neq|cdot|cdots|ldots|ddots|vdots|times|div|pm|mp|circ|ast|star|dagger|ddagger|amalg|cap|cup|uplus|sqcap|sqcup|vee|wedge|oplus|ominus|otimes|oslash|odot|bigcup|bigcap|bigvee|bigwedge|bigoplus|bigotimes|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|infty|partial|nabla|forall|exists|nexists|neg|lnot|approx|equiv|sim|simeq|cong|propto|subset|supset|subseteq|supseteq|subsetneq|supsetneq|in|notin|ni|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow|mapsto|implies|iff|to|gets|uparrow|downarrow|lim|limsup|liminf|sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|arcsin|arccos|arctan|log|ln|exp|max|min|sup|inf|det|dim|ker|gcd|deg|hom|arg|binom|dbinom|tbinom|choose|text|textrm|textbf|textit|textsf|texttt|mathrm|mathbf|mathbb|mathcal|mathfrak|mathscr|mathit|mathsf|boldsymbol|overline|underline|widehat|widetilde|overrightarrow|overleftarrow|hat|tilde|bar|vec|dot|ddot|acute|grave|check|breve|not|quad|qquad|left|right|big|Big|bigg|Bigg|langle|rangle|lceil|rceil|lfloor|rfloor|bmod|pmod|operatorname|stackrel|overset|underset|limits|nolimits|displaystyle|textstyle|scriptstyle|color|boxed|cancel|bcancel|xcancel|sout|begin|end|matrix|pmatrix|bmatrix|vmatrix|cases|array|aligned|gathered|split|substack)\b/;

const DELIMITED_RE = /\$\$([^$]+)\$\$|\$([^$\n]+)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]/g;
const LATEX_CMD_RE_G = new RegExp(LATEX_CMD_RE.source, "g");
const UNICODE_MATH = "→←↔⇒⇐⇔≠≤≥≈≡∼≅≢≁±∓∞·×÷∈∉∋⊂⊃⊆⊇⊄⊅∪∩∧∨¬∀∃∄∂∇√∑∏∐∫∬∭∮≪≫∝∅⟨⟩⌈⌉⌊⌋▶◀△▽⊕⊗⊖⊘";
const CH_MATH_OP = new RegExp("[0-9.+\\-=<>!,:|/ " + UNICODE_MATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "]");
const CH_ALPHA = /[a-zA-Z]/;
const SPACE_LOOK_CMD = /^\\[a-zA-Z]/;
const SPACE_LOOK_NUM = /^[0-9{^_]/;
const SPACE_LOOK_VAR_CMD = /^[a-zA-Z]{1,2}\s*\\[a-zA-Z]/;
const SPACE_LOOK_VAR_NUM = /^[a-zA-Z]{1,2}\s*[0-9+\-=<>]/;
const WORD_BEFORE_CMD = /^[a-zA-Z]+\s*[\\{^_]/;
const EXPAND_BACK_STOP = new RegExp("[0-9.+\\-=<>\\\\" + UNICODE_MATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "]");
export const HAS_DOLLAR = /\$[^$]+\$/;
const HAS_LPAREN = /\\\(/;
const HAS_LBRACKET = /\\\[/;

interface LatexRegion {
  start: number;
  end: number;
  latex: string;
  display?: boolean;
}

interface IsolateRegion {
  start: number;
  end: number;
  text: string;
  type?: string;
}

function isInsideSkip(node: Node) {
  let el = node.parentElement;
  while (el) {
    if (el.classList && (
      el.classList.contains("katex") ||
      el.classList.contains("katex-display") ||
      el.classList.contains("katex-html") ||
      el.classList.contains("katex-mathml")
    )) return true;
    const tag = el.tagName;
    if (tag === "MJX-CONTAINER" || tag === "PRE" || tag === "CODE") return true;
    if (el.hasAttribute("data-aleph-latex-rendered")) return true;
    if (el.hasAttribute("data-aleph-math-isolated")) return true;
    el = el.parentElement;
  }
  return false;
}

function isMessageStreaming(msg: Element) {
  if (PLATFORM === "chatgpt") {
    return !!(msg.closest(".result-streaming") || msg.querySelector(".result-streaming"));
  }
  return false;
}

export function extractLatexExpression(text: string, cmdStart: number): number {
  let end = cmdStart;
  const len = text.length;
  while (end < len) {
    const ch = text[end];
    if (ch === "\\") {
      let cmdEnd = end + 1;
      while (cmdEnd < len && CH_ALPHA.test(text[cmdEnd])) cmdEnd++;
      if (cmdEnd > end + 1) {
        end = cmdEnd;
        continue;
      }
      end = cmdEnd;
      continue;
    }
    if (ch === "{") {
      let depth = 1;
      end++;
      while (end < len && depth > 0) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}") depth--;
        end++;
      }
      continue;
    }
    if (ch === "^" || ch === "_") { end++; continue; }
    if ((ch === "(" || ch === "[") && end > cmdStart) {
      const prev = text[end - 1];
      if (CH_ALPHA.test(prev) || prev === "}") {
        const close = ch === "(" ? ")" : "]";
        let depth = 1;
        end++;
        while (end < len && depth > 0) {
          if (text[end] === ch) depth++;
          else if (text[end] === close) depth--;
          end++;
        }
        continue;
      }
    }
    if (CH_MATH_OP.test(ch)) {
      if (ch === " ") {
        const rest = text.slice(end + 1);
        if (SPACE_LOOK_CMD.test(rest) || SPACE_LOOK_NUM.test(rest)) {
          end++;
          continue;
        }
        if (SPACE_LOOK_VAR_CMD.test(rest)) {
          end++;
          continue;
        }
        if (SPACE_LOOK_VAR_NUM.test(rest)) {
          end++;
          continue;
        }
        break;
      }
      end++;
      continue;
    }
    if (CH_ALPHA.test(ch)) {
      const rest = text.slice(end);
      if (WORD_BEFORE_CMD.test(rest)) {
        end++;
        continue;
      }
      let wordEnd = end;
      while (wordEnd < len && CH_ALPHA.test(text[wordEnd])) wordEnd++;
      const word = text.slice(end, wordEnd);
      if (word.length <= 2) {
        end = wordEnd;
        if (end < len && text[end] === ",") {
          end++;
        }
        continue;
      }
      if (wordEnd < len && (text[wordEnd] === "{" || text[wordEnd] === "^" || text[wordEnd] === "_" || text[wordEnd] === "\\")) {
        end = wordEnd;
        continue;
      }
      break;
    }
    break;
  }
  return end;
}

export function expandBackward(text: string, start: number): number {
  let s = start;
  while (s > 0) {
    const ch = text[s - 1];
    if (CH_MATH_OP.test(ch)) {
      if (ch === " " && s - 2 >= 0 && !EXPAND_BACK_STOP.test(text[s - 2]) && !CH_ALPHA.test(text[s - 2])) break;
      s--;
    } else if (CH_ALPHA.test(ch)) {
      let ws = s - 1;
      while (ws > 0 && CH_ALPHA.test(text[ws - 1])) ws--;
      if (s - ws <= 2) { s = ws; } else { break; }
    } else break;
  }
  while (s < start && text[s] === " ") s++;
  return s;
}

export function findBareLatexRegions(text: string): LatexRegion[] {
  const regions: LatexRegion[] = [];
  LATEX_CMD_RE_G.lastIndex = 0;
  let match;
  while ((match = LATEX_CMD_RE_G.exec(text)) !== null) {
    let start = match.index;
    const end = extractLatexExpression(text, start);
    start = expandBackward(text, start);
    const latex = text.slice(start, end).trim();
    if (latex.length <= 1) continue;
    if (/^\\\w+$/.test(latex) && /^\\(?:n|t|r|s|d|w|b|0)$/.test(latex)) continue;
    regions.push({ start, end, latex });
  }
  const merged: LatexRegion[] = [];
  for (const r of regions.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && (r.start <= last.end ||
        (r.start - last.end <= 10 && !hasRTLScriptText(text.slice(last.end, r.start))))) {
      last.end = Math.max(last.end, r.end);
      last.latex = text.slice(last.start, last.end).trim();
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

const UNICODE_TO_LATEX: Array<[RegExp, string]> = [
  [/→/g, "\\to "], [/←/g, "\\leftarrow "], [/↔/g, "\\leftrightarrow "],
  [/⇒/g, "\\Rightarrow "], [/⇐/g, "\\Leftarrow "], [/⇔/g, "\\Leftrightarrow "],
  [/≠/g, "\\neq "], [/≤/g, "\\leq "], [/≥/g, "\\geq "],
  [/≈/g, "\\approx "], [/≡/g, "\\equiv "], [/∼/g, "\\sim "], [/≅/g, "\\cong "], [/≁/g, "\\nsim "],
  [/±/g, "\\pm "], [/∓/g, "\\mp "], [/∞/g, "\\infty "],
  [/·/g, "\\cdot "], [/×/g, "\\times "], [/÷/g, "\\div "],
  [/∈/g, "\\in "], [/∉/g, "\\notin "], [/∋/g, "\\ni "],
  [/⊂/g, "\\subset "], [/⊃/g, "\\supset "], [/⊆/g, "\\subseteq "], [/⊇/g, "\\supseteq "],
  [/∪/g, "\\cup "], [/∩/g, "\\cap "], [/∧/g, "\\wedge "], [/∨/g, "\\vee "],
  [/¬/g, "\\neg "], [/∀/g, "\\forall "], [/∃/g, "\\exists "],
  [/∂/g, "\\partial "], [/∇/g, "\\nabla "],
  [/∑/g, "\\sum "], [/∏/g, "\\prod "], [/∫/g, "\\int "], [/∬/g, "\\iint "], [/∭/g, "\\iiint "],
  [/√/g, "\\sqrt "],
  [/⟨/g, "\\langle "], [/⟩/g, "\\rangle "],
  [/⌈/g, "\\lceil "], [/⌉/g, "\\rceil "], [/⌊/g, "\\lfloor "], [/⌋/g, "\\rfloor "],
  [/⊕/g, "\\oplus "], [/⊗/g, "\\otimes "],
];

export function cleanMathText(s: string): string {
  for (const [re, repl] of UNICODE_TO_LATEX) s = s.replace(re, repl);
  s = s.replace(/,\s*;/g, ";");
  s = s.replace(/;\s*,/g, ";");
  s = s.replace(/[.,]\s*(d[a-z])(?=[,.\s)\]}]|$)/g, "\\,$1");
  s = s.replace(/(d[a-z])\s*,\s*(d[a-z])/g, "$1\\,$2");
  return s;
}

function renderLatexInNode(textNode: Text): Node | null {
  const text = textNode.textContent;
  if (!text || text.trim().length === 0) return null;

  const regions: LatexRegion[] = [];

  DELIMITED_RE.lastIndex = 0;
  let dm;
  while ((dm = DELIMITED_RE.exec(text)) !== null) {
    const latex = dm[1] || dm[2] || dm[3] || dm[4];
    if (hasRTLScriptText(latex)) continue;
    if (dm[2] !== undefined && !/[\\{}^_]/.test(dm[2])) continue;
    const display = !!(dm[1] || dm[4]);
    regions.push({ start: dm.index, end: dm.index + dm[0].length, latex, display });
  }

  const bare = findBareLatexRegions(text);
  for (const b of bare) {
    if (!regions.some(r => b.start < r.end && b.end > r.start)) {
      regions.push({ ...b, display: false });
    }
  }

  if (regions.length === 0) return null;

  regions.sort((a, b) => a.start - b.start);
  const merged: LatexRegion[] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && (r.start <= last.end ||
        (r.start - last.end <= 10 && !hasRTLScriptText(text.slice(last.end, r.start))))) {
      last.end = Math.max(last.end, r.end);
      last.latex = text.slice(last.start, last.end);
      last.display = last.display || r.display;
    } else {
      merged.push({ start: r.start, end: r.end, latex: r.latex || text.slice(r.start, r.end), display: r.display });
    }
  }

  const wrapper = document.createElement("span");
  wrapper.setAttribute("data-aleph-latex-rendered", "true");
  wrapper.style.unicodeBidi = "isolate";

  let lastEnd = 0;
  for (const region of merged) {
    if (region.start > lastEnd) {
      wrapper.appendChild(document.createTextNode(text.slice(lastEnd, region.start)));
    }

    const regionText = text.slice(region.start, region.end);
    if (hasRTLScriptText(regionText)) {
      wrapper.appendChild(document.createTextNode(regionText));
      lastEnd = region.end;
      continue;
    }

    let mathText = region.latex;
    mathText = mathText.replace(/^\$\$([\s\S]*)\$\$$/, "$1");
    mathText = mathText.replace(/^\$([^$]*)\$$/, "$1");
    mathText = mathText.replace(/^\\\(([\s\S]*)\\\)$/, "$1");
    mathText = mathText.replace(/^\\\[([\s\S]*)\\\]$/, "$1");
    mathText = cleanMathText(mathText);

    const ltrSpan = document.createElement("bdi");
    ltrSpan.setAttribute("dir", "ltr");

    try {
      katex.render(mathText.trim(), ltrSpan, {
        throwOnError: true,
        displayMode: region.display,
        output: "html",
      });
    } catch (e) {
      wrapper.appendChild(document.createTextNode(regionText));
      lastEnd = region.end;
      continue;
    }

    wrapper.appendChild(ltrSpan);
    lastEnd = region.end;
  }

  if (lastEnd < text.length) {
    wrapper.appendChild(document.createTextNode(text.slice(lastEnd)));
  }

  textNode.parentNode!.replaceChild(wrapper, textNode);
  return wrapper;
}

const MATH_PAREN_RE = /\((?=[^()]*[0-9])(?=[^()]*[=<>+\-/])[^()]*\)/g;
const MATH_PIPE_RE = /\|[^|\n]{1,50}\|/g;
const MATH_TILDE_RE = /[~∼≁]_?\w+/g;
const MATH_REPEAT_RE = /(?<![A-Za-z0-9_'])(?:\([^()\n]{1,40}\)[*+?]|[A-Za-z][0-9_']{0,3}[*+]|[0-9]+[*+])/g;

export function findEqRegions(text: string): IsolateRegion[] {
  const regions: IsolateRegion[] = [];
  let start = -1, hasEq = false, hasLetter = false;
  for (let i = 0; i <= text.length;) {
    const ch = i < text.length ? String.fromCodePoint(text.codePointAt(i)!) : null;
    const nextI = ch ? i + ch.length : i + 1;
    if (start === -1) {
      if (ch && !hasRTLScriptText(ch) && ch !== '\n' && ch !== ' ') {
        start = i;
        hasEq = ch === '=' || ch === '≠';
        hasLetter = /[a-zA-ZͰ-Ͽ]/.test(ch);
      }
    } else {
      if (!ch || hasRTLScriptText(ch) || ch === '\n') {
        if (hasEq && hasLetter) {
          let end = i;
          while (end > start && /[\s.,;:!?]/.test(text[end - 1])) end--;
          let d = 0;
          for (let j = start; j < end; j++) {
            const c = text[j];
            if (c === '(' || c === '{' || c === '[') d++;
            if (c === ')' || c === '}' || c === ']') { d--; if (d < 0) { end = j; break; } }
          }
          d = 0;
          for (let j = end - 1; j >= start; j--) {
            const c = text[j];
            if (c === ')' || c === '}' || c === ']') d++;
            if (c === '(' || c === '{' || c === '[') { d--; if (d < 0) { start = j + 1; break; } }
          }
          while (end > start && /[\s.,;:!?]/.test(text[end - 1])) end--;
          if (end > start) regions.push({ start, end, text: text.slice(start, end) });
        }
        start = -1; hasEq = false; hasLetter = false;
      } else {
        if (ch === '=' || ch === '≠') hasEq = true;
        if (/[a-zA-ZͰ-Ͽ]/.test(ch)) hasLetter = true;
      }
    }
    i = nextI;
  }
  return regions;
}

function collectRegions(re: RegExp, text: string, regions: IsolateRegion[], type?: string, skipRTL?: boolean) {
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (skipRTL && hasRTLScriptText(match[0])) continue;
    regions.push({ start: match.index, end: match.index + match[0].length, text: match[0], type });
  }
}

function hasMathCandidate(re: RegExp, text: string, skipRTL?: boolean) {
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (!skipRTL || !hasRTLScriptText(match[0])) return true;
  }
  return false;
}

function isolateMathText(textNode: Text): Node | null {
  const text = textNode.textContent || "";
  const regions: IsolateRegion[] = [];

  regions.push(...findEqRegions(text).map(r => ({ ...r, type: "eq" })));
  collectRegions(MATH_PAREN_RE, text, regions, undefined, true);
  collectRegions(MATH_PIPE_RE, text, regions, undefined, true);
  collectRegions(MATH_TILDE_RE, text, regions, "tilde");
  collectRegions(MATH_REPEAT_RE, text, regions, "repeat", true);

  if (regions.length === 0) return null;
  regions.sort((a, b) => a.start - b.start);
  const merged: IsolateRegion[] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) continue;
    merged.push(r);
  }

  const wrapper = document.createElement("span");
  wrapper.setAttribute("data-aleph-math-isolated", "true");
  wrapper.style.unicodeBidi = "isolate";
  let lastEnd = 0;
  for (const r of merged) {
    if (r.start > lastEnd) {
      wrapper.appendChild(document.createTextNode(text.slice(lastEnd, r.start)));
    }
    const ltrSpan = document.createElement("bdi");
    ltrSpan.setAttribute("dir", "ltr");
    if (r.type === "tilde" && typeof katex !== "undefined") {
      const cmd = r.text[0] === "≁" ? "\\nsim" : "\\sim";
      const sub = r.text.replace(/^[~∼≁]_?/, "");
      try {
        katex.render(cmd + "_{" + sub + "}", ltrSpan, { throwOnError: true, displayMode: false, output: "html" });
      } catch (e) {
        ltrSpan.textContent = r.text;
      }
    } else {
      ltrSpan.textContent = r.text;
    }
    wrapper.appendChild(ltrSpan);
    lastEnd = r.end;
  }
  if (lastEnd < text.length) {
    wrapper.appendChild(document.createTextNode(text.slice(lastEnd)));
  }
  textNode.parentNode!.replaceChild(wrapper, textNode);
  return wrapper;
}

export function shouldIsolateMathText(txt: string): boolean {
  return hasMathCandidate(MATH_PAREN_RE, txt, true) ||
         hasMathCandidate(MATH_PIPE_RE, txt, true) ||
         (MATH_TILDE_RE.lastIndex = 0, MATH_TILDE_RE.test(txt)) ||
         hasMathCandidate(MATH_REPEAT_RE, txt, true) ||
         findEqRegions(txt).length > 0;
}

// Per-message processed-gates: a pass skips messages whose textContent is
// unchanged since last processed (see rescan.ts). This keeps the TreeWalker
// + regex cost proportional to changed messages instead of total
// conversation size. Marked with the post-mutation text, so the pass our
// own wrapper writes trigger settles immediately.
const mathTextSeen = makeTextGate();
const latexSeen = makeTextGate();

// Messages skipped while streaming (ChatGPT's .result-streaming): the
// stream ending is a class change the body observer doesn't see, so a
// scoped pass would never revisit them. Parking a message calls
// notifyPending(), which starts index.ts's self-canceling drain; the drain
// re-runs passes (roots=[]) until these sets empty.
const mathTextPending = new Set<Element>();
const latexPending = new Set<Element>();

interface ScanProgress {
  text: string;
  anchor: Node;
}

interface ScanResult {
  complete: boolean;
  anchor?: Node;
}

const mathTextProgress = new WeakMap<Element, ScanProgress>();
const latexProgress = new WeakMap<Element, ScanProgress>();

function getScanAnchor(progress: WeakMap<Element, ScanProgress>, msg: Element, text: string): Node | null {
  const state = progress.get(msg);
  if (!state) return null;
  if (state.text !== text || !state.anchor.isConnected || !msg.contains(state.anchor)) {
    progress.delete(msg);
    return null;
  }
  return state.anchor;
}

function saveScanAnchor(progress: WeakMap<Element, ScanProgress>, msg: Element, text: string, anchor: Node) {
  if (anchor.isConnected && msg.contains(anchor)) {
    progress.set(msg, { text, anchor });
  } else {
    progress.delete(msg);
  }
}

function scanTextNodes(
  msg: Element,
  anchor: Node | null,
  deadline: number,
  isActionable: (text: string) => boolean,
  processNode: (node: Text) => Node | null,
): ScanResult {
  const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
  if (anchor) walker.currentNode = anchor;

  let node: Node | null;
  let lastVisited: Node | null = anchor;
  let visited = 0;
  while ((node = walker.nextNode())) {
    if (visited++ > 0 && deadline && performance.now() > deadline) {
      return lastVisited ? { complete: false, anchor: lastVisited } : { complete: false, anchor: msg };
    }
    lastVisited = node;
    if (isInsideSkip(node)) continue;
    const txt = node.textContent;
    if (!txt || txt.trim().length === 0) continue;
    if (!isActionable(txt)) continue;

    const replacement = processNode(node as Text);
    if (replacement) {
      // Keep scanning within the same slice: resume document order from the
      // wrapper (its internals are skipped by isInsideSkip, so this cannot
      // loop or re-process). The deadline check above bounds the slice.
      lastVisited = replacement;
      walker.currentNode = replacement;
    }
  }

  return { complete: true };
}

export function hasPendingLatexWork(): boolean {
  return latexPending.size > 0 || mathTextPending.size > 0;
}

// One parameterized runner for both scan modes — they differ only in what
// counts as actionable, how a node is processed, and which per-mode stores
// they use. Returns elements left unprocessed when the time budget
// (`deadline`, performance.now() epoch) ran out; the caller re-queues them
// as dirty roots for a continuation slice, and the per-mode progress maps
// resume inside the interrupted message instead of starting its TreeWalker
// from the top again.
interface ScanMode {
  gate: ReturnType<typeof makeTextGate>;
  pending: Set<Element>;
  progress: WeakMap<Element, ScanProgress>;
  isActionable(txt: string): boolean;
  processNode(node: Text): Node | null;
}

const mathTextMode: ScanMode = {
  gate: mathTextSeen,
  pending: mathTextPending,
  progress: mathTextProgress,
  isActionable: (txt) => {
    if (LATEX_CMD_RE.test(txt) || HAS_DOLLAR.test(txt) || HAS_LPAREN.test(txt) || HAS_LBRACKET.test(txt)) {
      return false;
    }
    return shouldIsolateMathText(txt);
  },
  processNode: isolateMathText,
};

const latexMode: ScanMode = {
  gate: latexSeen,
  pending: latexPending,
  progress: latexProgress,
  isActionable: (txt) =>
    LATEX_CMD_RE.test(txt) || HAS_DOLLAR.test(txt) || HAS_LPAREN.test(txt) || HAS_LBRACKET.test(txt),
  processNode: renderLatexInNode,
};

function runScan(mode: ScanMode, roots: Element[] | null, deadline: number): Element[] {
  const messageSel = SEL.message.join(", ");
  const candidates = new Set<Element>();
  for (const m of collectCandidates(roots, messageSel)) candidates.add(m);
  mode.pending.forEach((m) => { if (m.isConnected) candidates.add(m); });
  mode.pending.clear();
  const remainder: Element[] = [];
  let processedOne = false;
  for (const msg of candidates) {
    if (processedOne && deadline && performance.now() > deadline) { remainder.push(msg); continue; }
    if (isMessageStreaming(msg)) { mode.pending.add(msg); notifyPending(); continue; }
    const text = textOf(msg);
    const anchor = getScanAnchor(mode.progress, msg, text);
    if (!anchor && !mode.gate.changed(msg, text)) continue;
    processedOne = true;
    const result = scanTextNodes(msg, anchor, deadline, mode.isActionable, mode.processNode);
    // Single post-scan read — the text only changes via our own processNode
    // mutations within this synchronous call.
    const after = textOf(msg);
    if (!result.complete && result.anchor) {
      saveScanAnchor(mode.progress, msg, after, result.anchor);
      remainder.push(msg);
      continue;
    }
    mode.progress.delete(msg);
    mode.gate.mark(msg, after);
  }
  return remainder;
}

export function patchMathText(roots: Element[] | null = null, deadline = 0): Element[] {
  return runScan(mathTextMode, roots, deadline);
}

export function patchLatex(roots: Element[] | null = null, deadline = 0): Element[] {
  if (typeof katex === "undefined" || !getSettings().latexFix) return [];
  return runScan(latexMode, roots, deadline);
}
