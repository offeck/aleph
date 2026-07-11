import { DEFAULTS } from "../shared/defaults";

// Raw status map from the background (aleph-primer-status / -run-now) — per-target
// { at, ok, reason? }. Boundary shape read defensively.
type PrimerStatus = Record<string, { at: number; ok: boolean; reason?: string }>;

function setBadge(state: "off" | "on" | "fail") {
  const b = document.getElementById("primerPopBadge");
  if (!b) return;
  b.className = "trend-badge " + (state === "fail" ? "down" : state === "on" ? "up" : "flat");
  b.textContent = state === "fail" ? "needs attention" : state;
}

function renderStatus(res: PrimerStatus | undefined) {
  const entries = res ? Object.entries(res) : [];
  const failed = entries.filter(([, r]) => r && !r.ok);
  const enabled = (document.getElementById("primerPopEnabled") as HTMLInputElement | null)?.checked;
  setBadge(failed.length ? "fail" : enabled ? "on" : "off");

  const el = document.getElementById("primerPopStatus");
  if (!el) return;
  if (failed.length) {
    el.textContent = failed.map(([t, r]) => `${t}: ${r.reason || "failed"}`).join(" · ");
    el.style.display = "";
  } else if (entries.length) {
    el.textContent = "last run ok";
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "aleph-primer-status" }, (res) => {
    if (chrome.runtime.lastError) return;
    renderStatus(res as PrimerStatus | undefined);
  });
}

export function loadPrimerControl() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    const t = document.getElementById("primerPopEnabled") as HTMLInputElement | null;
    if (t) t.checked = s.primerEnabled;
    setBadge(s.primerEnabled ? "on" : "off");
  });
  refreshStatus();
}

export function bindPrimerControl() {
  const toggle = document.getElementById("primerPopEnabled") as HTMLInputElement | null;
  toggle?.addEventListener("change", () => {
    chrome.storage.sync.set({ primerEnabled: toggle.checked });
    setBadge(toggle.checked ? "on" : "off");
    refreshStatus();
  });

  const btn = document.getElementById("primerPopNow") as HTMLButtonElement | null;
  btn?.addEventListener("click", () => {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Priming…";
    chrome.runtime.sendMessage({ type: "aleph-primer-run-now" }, (res) => {
      btn.disabled = false;
      btn.textContent = prev || "Prime now";
      if (chrome.runtime.lastError) return;
      renderStatus(res as PrimerStatus | undefined);
    });
  });
}
