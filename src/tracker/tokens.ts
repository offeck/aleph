import { countRTLScriptLetters } from "../shared/rtl";
import { PLATFORM } from "./platform";
import type { Platform } from "../shared/platform";

// Chars-per-token ratios tuned per platform tokenizer and content type.
// Claude uses a custom BPE tokenizer, ChatGPT uses tiktoken (o200k_base),
// Gemini uses SentencePiece — each handles RTL scripts, code, and Latin differently.
// Whitespace/punctuation tokenize at ~1 token per character on all platforms.
export const TOKEN_RATIOS = {
  claude:  { latin: 3.8, rtl: 2.0, code: 2.8, whitespace: 5.0 },
  chatgpt: { latin: 4.0, rtl: 1.7, code: 2.5, whitespace: 5.5 },
  gemini:  { latin: 4.2, rtl: 2.2, code: 3.0, whitespace: 5.0 },
};

export function estimateTokens(text: string | null | undefined, platform: Platform | null = PLATFORM): number {
  if (!text) return 0;
  const ratios = (platform && TOKEN_RATIOS[platform]) || TOKEN_RATIOS.chatgpt;

  let tokens = 0;

  // Extract code blocks first — they tokenize differently (operators, indentation)
  const codeBlocks: string[] = [];
  const withoutCode = text.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
    codeBlocks.push(m);
    return "";
  });
  for (const block of codeBlocks) {
    tokens += block.length / ratios.code;
  }

  // Split remaining into RTL-script letters, Latin words, and whitespace/punctuation
  const rtlChars = countRTLScriptLetters(withoutCode);
  const wsChars = (withoutCode.match(/[\s\n\r\t]+/g) || []).join("").length;
  const latinChars = Math.max(0, Array.from(withoutCode).length - rtlChars - wsChars);

  tokens += rtlChars / ratios.rtl;
  tokens += latinChars / ratios.latin;
  tokens += wsChars / ratios.whitespace;

  return Math.ceil(tokens);
}

// Images cost tokens too — roughly 1600 tokens per image on Claude/ChatGPT,
// varies on Gemini. Count <img> tags inside messages and add to estimate.
export const IMG_TOKEN_COST = { claude: 1600, chatgpt: 1600, gemini: 1200 };

function isContentImage(img: HTMLImageElement) {
  if (img.closest?.('[data-testid*="avatar" i], [class*="avatar" i], [aria-label*="avatar" i]')) return false;
  const w = img.naturalWidth || parseInt(img.getAttribute("width") || "", 10) || 0;
  const h = img.naturalHeight || parseInt(img.getAttribute("height") || "", 10) || 0;
  return !w || !h || (w * h) >= 4096;
}

function countFileAttachments(el: Element) {
  const selector = '[data-testid*="file" i], [aria-label*="file" i], a[href*="/backend-api/files/"], a[href*="attachment"], [class*="attachment" i]';
  const candidates = Array.from(el.querySelectorAll(selector));
  const hrefs = new Set<string>();
  const noHrefCandidates: Element[] = [];
  for (const node of candidates) {
    const link = node.matches?.('a[href*="/backend-api/files/"], a[href*="attachment"]')
      ? (node as HTMLAnchorElement)
      : node.querySelector?.<HTMLAnchorElement>('a[href*="/backend-api/files/"], a[href*="attachment"]');
    if (link?.href) hrefs.add("href:" + link.href);
    else noHrefCandidates.push(node);
  }
  return hrefs.size + countContainmentRoots(noHrefCandidates);
}

// Count elements not contained by another element in the list — nested
// attachment chips collapse into their outermost candidate. Ancestor-climb
// against a Set instead of pairwise contains() so big messages stay
// O(n·depth) rather than O(n²). Exported for unit tests.
export function countContainmentRoots(nodes: Element[]): number {
  const set = new Set(nodes);
  let roots = 0;
  for (const node of nodes) {
    let contained = false;
    for (let p = node.parentElement; p; p = p.parentElement) {
      if (set.has(p)) { contained = true; break; }
    }
    if (!contained) roots++;
  }
  return roots;
}

export interface MessageEstimate {
  text: string;
  textTokens: number;
  imageTokens: number;
  fileTokens: number;
  imageCount: number;
  fileCount: number;
  totalTokens: number;
}

export function estimateMessage(el: Element, platform: Platform | null = PLATFORM): MessageEstimate {
  const text = el.textContent || "";
  const images = Array.from(el.querySelectorAll<HTMLImageElement>("img")).filter(isContentImage);
  const fileCount = countFileAttachments(el);
  const textTokens = estimateTokens(text, platform);
  const imageTokens = images.length * ((platform && IMG_TOKEN_COST[platform]) || 1600);
  const fileTokens = 0;
  return {
    text,
    textTokens,
    imageTokens,
    fileTokens,
    imageCount: images.length,
    fileCount,
    totalTokens: textTokens + imageTokens + fileTokens,
  };
}
