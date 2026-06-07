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

// Timer/now indirection so the scheduler is deterministically unit-testable
// (vi fake timers auto-fire due timers and cannot model "a microtask-delivered
// notify clears the due 0ms timer before its task runs").
export interface SchedulerHooks {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

// Debounced mutation scheduler with a hard max-wait. The starvation fix lives
// in the `delay <= 0` branch: once the max-wait deadline is reached, notify()
// must NOT clear-and-reinstall the pending timer — every prior install used
// debounceDelay, so the pending timer's fire time is already ≤ firstAt +
// maxWaitMs and clearing it is what let sustained mutation churn postpone the
// pass forever (trace signature: 2,623 zero-delay installs vs ~81 fires).
export function makeMutationScheduler(
  fire: () => void,
  quietMs: number,
  maxWaitMs: number,
  hooks?: Partial<SchedulerHooks>,
): { notify(): void } {
  const h: SchedulerHooks = {
    now: () => Date.now(),
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ...hooks,
  };
  let timer: unknown = null;
  let firstAt = 0;
  const onFire = () => {
    timer = null;
    fire();
  };
  return {
    notify() {
      const now = h.now();
      if (timer !== null) {
        const delay = debounceDelay(now, firstAt, quietMs, maxWaitMs);
        if (delay <= 0) return; // max-wait reached — let the pending timer fire
        h.clear(timer);
        timer = h.set(onFire, delay);
      } else {
        firstAt = now;
        timer = h.set(onFire, debounceDelay(now, firstAt, quietMs, maxWaitMs));
      }
    },
  };
}

// ── Pending work queue (slice continuation) ────────────────────────────
// Scanner-owned candidate queues: collected once per event/full pass, then
// drained across 30ms continuation slices by cursor — never re-collected
// (the former continuationRoots design re-ran collectCandidates over the
// whole remaining set every slice: O(N) collection per slice, O(N²) total).
//   "skip" — no real work (gate-skip/excluded); drop and keep going even
//            past the deadline, so a backlog of finished elements clears
//            in one slice.
//   "done" — real work done; drop; the next item honors the deadline.
//   "keep" — real work done but the element is unfinished (latex message
//            interrupted mid-TreeWalker); it STAYS at the cursor and the
//            slice ends — the next drain resumes on the same element.
export type DrainVerdict = "skip" | "done" | "keep";

export interface PendingQueue {
  merge(items: Iterable<Element>): void;
  drain(process: (el: Element) => DrainVerdict, deadline: number): boolean;
  size(): number;
  reset(): void;
}

// Priority drain: backlog only runs when the event queue is fully drained
// AND budget remains. Each queue carries its own hard-progress rule, so
// draining them back-to-back unconditionally would let backlog process an
// extra item after event work already exhausted the slice (weakening both
// fresh-work priority and the per-scanner budget). A skipped backlog is not
// starved — the event queue is empty by the next slice, which reaches it.
export function drainWithPriority(
  eventQ: PendingQueue,
  backlogQ: PendingQueue,
  process: (el: Element) => DrainVerdict,
  deadline: number,
): void {
  const eventHasMore = eventQ.drain(process, deadline);
  if (eventHasMore) return;
  if (deadline && performance.now() > deadline) return;
  backlogQ.drain(process, deadline);
}

export function makePendingQueue(): PendingQueue {
  let items: Element[] = [];
  let cursor = 0;
  const queued = new Set<Element>(); // mirror of items[cursor..] for O(1) dedupe
  return {
    // Dedupe only against the not-yet-processed tail: already-drained
    // elements re-queue legitimately (their text may have changed again);
    // the scanners' text gates make any residual duplicate a cheap skip.
    merge(add) {
      for (const el of add) {
        if (!queued.has(el)) {
          queued.add(el);
          items.push(el);
        }
      }
    },
    drain(process, deadline) {
      let didWork = false;
      while (cursor < items.length) {
        const el = items[cursor];
        if (!el.isConnected) {
          queued.delete(el);
          cursor++;
          continue;
        }
        // Hard-progress: real work happens at least once per slice; only
        // real work arms the deadline stop ("skip" verdicts never do).
        if (didWork && deadline && performance.now() > deadline) break;
        const verdict = process(el);
        if (verdict === "keep") {
          didWork = true;
          break; // stays at the cursor and in the dedupe set
        }
        queued.delete(el);
        cursor++;
        if (verdict === "done") didWork = true;
      }
      // Compaction: drop the consumed prefix so drained Element refs don't
      // accumulate for the queue's lifetime (the old continuationRoots Set
      // was cleared every pass; a cursor alone would be a new leak).
      if (cursor > 0) {
        items = items.slice(cursor);
        cursor = 0;
      }
      return items.length > 0;
    },
    size: () => items.length - cursor,
    reset() {
      items = [];
      cursor = 0;
      queued.clear();
    },
  };
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
  fullPassNeeded: boolean;
}

// Continuation/drain passes (eventPass=false) carry no roots: slice leftovers
// live in the scanners' own pending queues now. Invariants preserved: a
// non-event pass never consumes a queued full pass and never steals dirty
// roots from the next event pass.
export function takePatchRoots(queues: PatchRootQueues, eventPass: boolean): Element[] | null {
  if (!eventPass) return [];
  if (queues.fullPassNeeded) {
    queues.fullPassNeeded = false;
    queues.dirtyRoots.clear();
    return null;
  }
  const roots = Array.from(queues.dirtyRoots);
  queues.dirtyRoots.clear();
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
