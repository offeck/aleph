import { MINI_GAME_OVERLAY_ID } from "../shared/domIds";

// ── Rescan gates ───────────────────────────────────────────────────────
// Shared memoization primitives that keep patch passes proportional to
// changed DOM instead of total conversation size.

export function textOf(el: Element): string {
  return el.textContent || "";
}

// Tracks the exact textContent last processed per element; a pass skips
// elements whose text is unchanged. Comparing the full string (not a
// length) keeps the gate correct for same-length replacements; the string
// is already materialized for the comparison, so the added cost is a
// native string compare. WeakMap-keyed, so stored text is GC'd with its
// node (≈1× page text retained while nodes live).
export interface TextGate {
  changed(el: Element, text: string): boolean;
  mark(el: Element, text: string): void;
}

export function makeTextGate(): TextGate {
  const seen = new WeakMap<Element, string>();
  return {
    changed: (el, text) => seen.get(el) !== text,
    mark: (el, text) => { seen.set(el, text); },
  };
}

// Debounce-with-maxWait arithmetic (pure, unit-tested): fire after `quietMs`
// of silence, but never later than `maxWaitMs` after the first unflushed
// mutation — continuous streaming mutations can't starve the pass.
export function debounceDelay(now: number, firstAt: number, quietMs: number, maxWaitMs: number): number {
  const untilMax = firstAt + maxWaitMs - now;
  return Math.max(0, Math.min(quietMs, untilMax));
}

// Pending-work notification: scanners call notifyPending() when they park
// observer-invisible work (ChatGPT streaming-end class changes, hint-window
// expiry); index.ts registers the self-canceling drain at boot. The
// leaf-module indirection avoids an import cycle.
let onPendingCb: (() => void) | null = null;
export function setOnPending(cb: () => void) { onPendingCb = cb; }
export function notifyPending() { if (onPendingCb) onPendingCb(); }

// Resolve the elements a scoped pass must process for `sel`: every selector
// match that CONTAINS a dirty root (ancestors — their textContent changed
// too) plus every match INSIDE one (covers added subtrees), plus the root
// itself when it matches. roots === null means a full pass over the
// document. Cost is O(dirty × depth), independent of conversation size.
export function collectCandidates(roots: Element[] | null, sel: string): Iterable<Element> {
  if (!roots) return document.querySelectorAll(sel);
  const out = new Set<Element>();
  for (const r of roots) {
    if (!r.isConnected) continue;
    for (let a: Element | null = r.closest(sel); a; a = a.parentElement ? a.parentElement.closest(sel) : null) {
      out.add(a);
    }
    r.querySelectorAll(sel).forEach((e) => out.add(e));
  }
  return out;
}

export interface PatchRootQueues {
  dirtyRoots: Set<Element>;
  continuationRoots: Set<Element>;
  fullPassNeeded: boolean;
}

export function takePatchRoots(queues: PatchRootQueues, eventPass: boolean): Element[] | null {
  if (eventPass && queues.fullPassNeeded) {
    queues.fullPassNeeded = false;
    queues.dirtyRoots.clear();
    queues.continuationRoots.clear();
    return null;
  }

  if (eventPass) {
    const roots = Array.from(queues.dirtyRoots);
    queues.dirtyRoots.clear();
    return roots;
  }

  const roots = Array.from(queues.continuationRoots);
  queues.continuationRoots.clear();
  return roots;
}

// Aleph-authored DOM (latex/math wrappers, the mini-game overlay): mutations
// in or about these nodes are our own writes and must not re-trigger patch
// passes. Keep in sync with the wrapper attributes in latex.ts.
const ALEPH_AUTHORED_SEL =
  `#${MINI_GAME_OVERLAY_ID}, [data-aleph-latex-rendered], [data-aleph-math-isolated]`;

export function isAlephAuthored(node: Node): boolean {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!(el && el.closest && el.closest(ALEPH_AUTHORED_SEL));
}
