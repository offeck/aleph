import { describe, expect, it, vi } from "vitest";
import {
  collectCandidates,
  debounceDelay,
  drainWithPriority,
  isAlephAuthored,
  makeMutationScheduler,
  makePendingQueue,
  makeTextGate,
  takePatchRoots,
  textOf,
  type DrainVerdict,
  type PatchRootQueues,
} from "../../src/content/rescan";

describe("debounceDelay", () => {
  it("uses the quiet window when far from maxWait", () => {
    expect(debounceDelay(1000, 1000, 120, 500)).toBe(120);
  });

  it("caps at the remaining time to maxWait under continuous mutations", () => {
    expect(debounceDelay(1400, 1000, 120, 500)).toBe(100);
  });

  it("fires immediately once maxWait has elapsed", () => {
    expect(debounceDelay(1600, 1000, 120, 500)).toBe(0);
  });
});

const el = (textContent: string | null) => ({ textContent }) as unknown as Element;

describe("makeTextGate", () => {
  it("reports changed for unseen elements", () => {
    const gate = makeTextGate();
    expect(gate.changed(el("abc"), "abc")).toBe(true);
  });

  it("skips elements marked with the same text", () => {
    const gate = makeTextGate();
    const e = el("abc");
    gate.mark(e, "abc");
    expect(gate.changed(e, "abc")).toBe(false);
  });

  it("re-fires when the text changes, then settles after re-mark", () => {
    const gate = makeTextGate();
    const e = el("abc");
    gate.mark(e, "abc");
    expect(gate.changed(e, "abcdefg")).toBe(true);
    gate.mark(e, "abcdefg");
    expect(gate.changed(e, "abcdefg")).toBe(false);
  });

  it("catches same-length replacements", () => {
    const gate = makeTextGate();
    const e = el("שלום");
    gate.mark(e, "שלום");
    expect(gate.changed(e, "abcd")).toBe(true);
  });

  it("tracks elements independently", () => {
    const gate = makeTextGate();
    const a = el("abc");
    const b = el("abc");
    gate.mark(a, "abc");
    expect(gate.changed(b, "abc")).toBe(true);
  });
});

describe("textOf", () => {
  it("returns the textContent, empty string when null", () => {
    expect(textOf(el("שלום"))).toBe("שלום");
    expect(textOf(el(""))).toBe("");
    expect(textOf(el(null))).toBe("");
  });
});

describe("collectCandidates", () => {
  // Minimal Element stand-ins covering the scoped path (roots !== null —
  // the null path hits document.querySelectorAll, which needs a browser).
  const node = (over: object = {}) =>
    ({
      isConnected: true,
      closest: () => null,
      parentElement: null,
      querySelectorAll: () => [],
      ...over,
    }) as unknown as Element;

  it("collects matching ancestors (closest chain) and descendants", () => {
    const a2 = node({ parentElement: { closest: () => null } });
    const a1 = node({ parentElement: { closest: () => a2 } });
    const d1 = node();
    const root = node({ closest: () => a1, querySelectorAll: () => [d1] });
    expect([...collectCandidates([root], "sel")]).toEqual([a1, a2, d1]);
  });

  it("skips disconnected roots", () => {
    const root = node({ isConnected: false });
    expect([...collectCandidates([root], "sel")]).toEqual([]);
  });

  it("dedupes shared ancestors across roots", () => {
    const shared = node();
    const r1 = node({ closest: () => shared });
    const r2 = node({ closest: () => shared });
    expect([...collectCandidates([r1, r2], "sel")]).toEqual([shared]);
  });
});

describe("takePatchRoots", () => {
  const node = () => ({}) as unknown as Element;
  const queues = (fullPassNeeded = false): PatchRootQueues => ({
    dirtyRoots: new Set<Element>(),
    fullPassNeeded,
  });

  it("event full passes cover the whole document and clear dirty roots", () => {
    const q = queues(true);
    q.dirtyRoots.add(node());

    expect(takePatchRoots(q, true)).toBeNull();
    expect(q.fullPassNeeded).toBe(false);
    expect(q.dirtyRoots.size).toBe(0);
  });

  it("event scoped passes consume the dirty roots", () => {
    const q = queues();
    const dirty = node();
    q.dirtyRoots.add(dirty);

    expect(takePatchRoots(q, true)).toEqual([dirty]);
    expect(q.dirtyRoots.size).toBe(0);
  });

  it("non-event passes carry no roots and preserve dirty roots for the event pass", () => {
    const q = queues();
    const dirty = node();
    q.dirtyRoots.add(dirty);

    expect(takePatchRoots(q, false)).toEqual([]);
    expect([...q.dirtyRoots]).toEqual([dirty]);
  });

  it("non-event passes do not consume a pending full event pass", () => {
    const q = queues(true);

    expect(takePatchRoots(q, false)).toEqual([]);
    expect(q.fullPassNeeded).toBe(true);
  });
});

// ── makeMutationScheduler ────────────────────────────────────────────────
// Manual timer harness (NOT vi.useFakeTimers — fake timers auto-fire due
// timers when advanced, which cannot model the starvation interleaving: a
// microtask-delivered notify clearing the due 0ms timer before its task runs).
function makeTimerHarness() {
  let now = 0;
  let nextId = 1;
  let installs = 0;
  let clears = 0;
  const pending = new Map<number, () => void>();
  return {
    hooks: {
      now: () => now,
      set: (fn: () => void, _ms: number) => {
        installs++;
        const id = nextId++;
        pending.set(id, fn);
        return id;
      },
      clear: (id: unknown) => {
        clears++;
        pending.delete(id as number);
      },
    },
    advance: (ms: number) => {
      now += ms;
    },
    firePending: () => {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((f) => f());
    },
    counts: () => ({ installs, clears, pending: pending.size }),
  };
}

describe("makeMutationScheduler", () => {
  it("a single notify fires after the quiet window", () => {
    const h = makeTimerHarness();
    const fire = vi.fn();
    const s = makeMutationScheduler(fire, 120, 500, h.hooks);

    s.notify();
    expect(h.counts().installs).toBe(1);
    h.advance(120);
    h.firePending();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("sustained churn cannot starve the pass: installs go flat once maxWait is reached", () => {
    // Trace signature of the defect: 2,623 zero-delay installs vs ~81 fires —
    // the old clear-and-reset logic cleared the due timer on every notify.
    const h = makeTimerHarness();
    const fire = vi.fn();
    const s = makeMutationScheduler(fire, 120, 500, h.hooks);

    // Mutations every 1ms; the pending timer is never given a task turn.
    for (let t = 0; t <= 500; t++) {
      s.notify();
      h.advance(1);
    }
    const atMaxWait = h.counts();

    for (let t = 0; t < 100; t++) {
      s.notify();
      h.advance(1);
    }
    const after = h.counts();

    // Past maxWait, notify() must not clear nor re-install — the surviving
    // pending timer is the guaranteed fire.
    expect(after.installs).toBe(atMaxWait.installs);
    expect(after.clears).toBe(atMaxWait.clears);
    expect(after.pending).toBe(1);
    expect(fire).not.toHaveBeenCalled();

    h.firePending();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("resets the maxWait window after firing", () => {
    const h = makeTimerHarness();
    const fire = vi.fn();
    const s = makeMutationScheduler(fire, 120, 500, h.hooks);

    s.notify();
    h.advance(120);
    h.firePending();
    expect(fire).toHaveBeenCalledTimes(1);

    // New window: a fresh notify installs a fresh quiet-window timer.
    s.notify();
    expect(h.counts().pending).toBe(1);
    h.advance(120);
    h.firePending();
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("re-debounces within the quiet window before maxWait", () => {
    const h = makeTimerHarness();
    const fire = vi.fn();
    const s = makeMutationScheduler(fire, 120, 500, h.hooks);

    s.notify();
    h.advance(60);
    s.notify(); // still inside the window: clear + re-install
    expect(h.counts().installs).toBe(2);
    expect(h.counts().clears).toBe(1);
    expect(h.counts().pending).toBe(1);
  });
});

// ── makePendingQueue ─────────────────────────────────────────────────────
describe("makePendingQueue", () => {
  const el = (connected = true) => ({ isConnected: connected }) as unknown as Element;
  const PAST_DEADLINE = 1; // performance.now() is always past this
  const NO_DEADLINE = 0;

  it("merge dedupes against the not-yet-processed tail only", () => {
    const q = makePendingQueue();
    const a = el();
    q.merge([a, a]);
    q.merge([a]);
    expect(q.size()).toBe(1);
  });

  it("re-merge after a drain re-queues the element", () => {
    const q = makePendingQueue();
    const a = el();
    q.merge([a]);
    expect(q.drain(() => "done", NO_DEADLINE)).toBe(false);
    expect(q.size()).toBe(0);
    q.merge([a]);
    expect(q.size()).toBe(1);
  });

  it("drops disconnected elements without processing them", () => {
    const q = makePendingQueue();
    const process = vi.fn<(e: Element) => DrainVerdict>(() => "done");
    q.merge([el(false)]);
    expect(q.drain(process, NO_DEADLINE)).toBe(false);
    expect(process).not.toHaveBeenCalled();
    expect(q.size()).toBe(0);
  });

  it("hard-progress: one real-work element processes even past the deadline", () => {
    const q = makePendingQueue();
    const process = vi.fn<(e: Element) => DrainVerdict>(() => "done");
    q.merge([el(), el(), el()]);
    expect(q.drain(process, PAST_DEADLINE)).toBe(true);
    expect(process).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(2);
  });

  it("skip verdicts never arm the deadline stop: a finished backlog clears in one slice", () => {
    const q = makePendingQueue();
    const process = vi.fn<(e: Element) => DrainVerdict>(() => "skip");
    q.merge([el(), el(), el(), el()]);
    expect(q.drain(process, PAST_DEADLINE)).toBe(false);
    expect(process).toHaveBeenCalledTimes(4);
    expect(q.size()).toBe(0);
  });

  it("keep ends the slice with the element still at the cursor; the next drain resumes on it", () => {
    const q = makePendingQueue();
    const a = el();
    const b = el();
    const seen: Element[] = [];
    q.merge([a, b]);

    expect(q.drain((e) => { seen.push(e); return "keep"; }, NO_DEADLINE)).toBe(true);
    expect(seen).toEqual([a]);
    expect(q.size()).toBe(2);

    expect(q.drain((e) => { seen.push(e); return "done"; }, NO_DEADLINE)).toBe(false);
    expect(seen).toEqual([a, a, b]);
  });

  it("a kept element stays in the dedupe tail (no duplicate on merge)", () => {
    const q = makePendingQueue();
    const a = el();
    q.merge([a]);
    q.drain(() => "keep", NO_DEADLINE);
    q.merge([a]);
    expect(q.size()).toBe(1);
  });

  it("reset discards mid-drain state", () => {
    const q = makePendingQueue();
    const process = vi.fn<(e: Element) => DrainVerdict>(() => "done");
    q.merge([el(), el()]);
    q.drain(process, PAST_DEADLINE); // processes one, leaves one
    q.reset();
    expect(q.size()).toBe(0);
    process.mockClear();
    expect(q.drain(process, NO_DEADLINE)).toBe(false);
    expect(process).not.toHaveBeenCalled();
  });
});

describe("drainWithPriority", () => {
  const el = () => ({ isConnected: true }) as unknown as Element;
  const PAST_DEADLINE = 1;
  const NO_DEADLINE = 0;

  it("drains event then backlog when budget allows", () => {
    const eventQ = makePendingQueue();
    const backlogQ = makePendingQueue();
    const a = el();
    const b = el();
    eventQ.merge([a]);
    backlogQ.merge([b]);
    const seen: Element[] = [];
    drainWithPriority(eventQ, backlogQ, (e) => { seen.push(e); return "done"; }, NO_DEADLINE);
    expect(seen).toEqual([a, b]);
  });

  it("never touches backlog while the event queue has leftovers", () => {
    const eventQ = makePendingQueue();
    const backlogQ = makePendingQueue();
    eventQ.merge([el(), el(), el()]);
    backlogQ.merge([el()]);
    const seen: Element[] = [];
    // Past deadline: event hard-progresses one item and keeps the rest.
    drainWithPriority(eventQ, backlogQ, (e) => { seen.push(e); return "done"; }, PAST_DEADLINE);
    expect(seen.length).toBe(1);
    expect(eventQ.size()).toBe(2);
    expect(backlogQ.size()).toBe(1);
  });

  it("skips backlog when the budget is already exhausted, even with an empty event queue", () => {
    const eventQ = makePendingQueue();
    const backlogQ = makePendingQueue();
    backlogQ.merge([el()]);
    const process = vi.fn<(e: Element) => DrainVerdict>(() => "done");
    drainWithPriority(eventQ, backlogQ, process, PAST_DEADLINE);
    expect(process).not.toHaveBeenCalled();
    expect(backlogQ.size()).toBe(1);
  });

  it("a keep in the event queue holds backlog for the next slice", () => {
    const eventQ = makePendingQueue();
    const backlogQ = makePendingQueue();
    eventQ.merge([el()]);
    backlogQ.merge([el()]);
    const seen: Element[] = [];
    drainWithPriority(eventQ, backlogQ, (e) => { seen.push(e); return "keep"; }, NO_DEADLINE);
    expect(seen.length).toBe(1);
    expect(eventQ.size()).toBe(1);
    expect(backlogQ.size()).toBe(1);
  });
});

describe("isAlephAuthored", () => {
  const fakeEl = (closestHit: boolean): Element =>
    ({ nodeType: 1, closest: () => (closestHit ? {} : null) }) as unknown as Element;

  it("flags elements in or under aleph-authored wrappers", () => {
    expect(isAlephAuthored(fakeEl(true))).toBe(true);
  });

  it("passes through plain page elements", () => {
    expect(isAlephAuthored(fakeEl(false))).toBe(false);
  });

  it("uses parentElement for text nodes and tolerates detached nodes", () => {
    expect(isAlephAuthored({ nodeType: 3, parentElement: null } as unknown as Node)).toBe(false);
    expect(isAlephAuthored({ nodeType: 3, parentElement: fakeEl(true) } as unknown as Node)).toBe(true);
  });
});
