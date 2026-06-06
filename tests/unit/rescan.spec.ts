import { describe, expect, it } from "vitest";
import {
  collectCandidates,
  debounceDelay,
  isAlephAuthored,
  makeTextGate,
  takePatchRoots,
  textOf,
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
    continuationRoots: new Set<Element>(),
    fullPassNeeded,
  });

  it("event full passes cover the whole document and clear queued roots", () => {
    const q = queues(true);
    const dirty = node();
    const continuation = node();
    q.dirtyRoots.add(dirty);
    q.continuationRoots.add(continuation);

    expect(takePatchRoots(q, true)).toBeNull();
    expect(q.fullPassNeeded).toBe(false);
    expect(q.dirtyRoots.size).toBe(0);
    expect(q.continuationRoots.size).toBe(0);
  });

  it("event scoped passes consume only real dirty roots", () => {
    const q = queues();
    const dirty = node();
    const continuation = node();
    q.dirtyRoots.add(dirty);
    q.continuationRoots.add(continuation);

    expect(takePatchRoots(q, true)).toEqual([dirty]);
    expect(q.dirtyRoots.size).toBe(0);
    expect([...q.continuationRoots]).toEqual([continuation]);
  });

  it("non-event continuation passes preserve dirty roots for the event pass", () => {
    const q = queues();
    const dirty = node();
    const continuation = node();
    q.dirtyRoots.add(dirty);
    q.continuationRoots.add(continuation);

    expect(takePatchRoots(q, false)).toEqual([continuation]);
    expect([...q.dirtyRoots]).toEqual([dirty]);
    expect(q.continuationRoots.size).toBe(0);
  });

  it("non-event passes do not consume a pending full event pass", () => {
    const q = queues(true);
    const continuation = node();
    q.continuationRoots.add(continuation);

    expect(takePatchRoots(q, false)).toEqual([continuation]);
    expect(q.fullPassNeeded).toBe(true);
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
