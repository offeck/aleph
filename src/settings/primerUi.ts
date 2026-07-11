import { DEFAULTS } from "../shared/defaults";

const $ = (id: string) => document.getElementById(id);
const val = (id: string) => ($(id) as HTMLInputElement | null)?.value ?? "";
const checked = (id: string) => ($(id) as HTMLInputElement | null)?.checked ?? false;

const TOGGLES = [
  "primerEnabled", "primerActiveHoursEnabled", "primerTargetClaude",
  "primerTargetCodex", "primerAutoDeleteClaude", "primerJitterEnabled",
] as const;
const TEXTS = ["primerMode", "primerActiveStart", "primerActiveEnd", "primerJitterSeconds"] as const;

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function updateModeVisibility(mode: string) {
  const smart = mode === "smart";
  const s = $("primerSmartFields"); if (s) s.style.display = smart ? "" : "none";
  const sc = $("primerScheduledFields"); if (sc) sc.style.display = smart ? "none" : "";
  const risk = $("primerSmartRisk"); if (risk) risk.style.display = smart ? "" : "none";
}

export function loadPrimerUI(): void {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    TOGGLES.forEach((k) => { const el = $(k) as HTMLInputElement | null; if (el) el.checked = Boolean(s[k]); });
    TEXTS.forEach((k) => { const el = $(k) as HTMLInputElement | null; if (el) el.value = String(s[k]); });
    const times = $("primerTimes") as HTMLInputElement | null;
    if (times) times.value = (s.primerTimes as string[]).join(", ");
    const off = $("primerOffDays") as HTMLInputElement | null;
    if (off) off.value = (s.primerOffDays as number[]).join(", ");
    updateModeVisibility(String(s.primerMode));
  });
  refreshStatus();
}

function refreshStatus() {
  chrome.runtime.sendMessage(
    { type: "aleph-primer-status" },
    (res: Record<string, { at: number; ok: boolean; reason?: string }> | undefined) => {
      const el = $("primerStatus");
      if (!el) return;
      const entries = res ? Object.entries(res) : [];
      el.textContent = entries.length
        ? entries.map(([t, r]) => `${t}: ${r.ok ? "ok" : "FAILED — " + (r.reason || "error")}`).join("   ·   ")
        : "no runs yet";
    },
  );
}

export function bindPrimerEvents(): void {
  const save = (k: string, v: unknown) => chrome.storage.sync.set({ [k]: v });
  TOGGLES.forEach((k) => $(k)?.addEventListener("change", () => save(k, checked(k))));
  $("primerMode")?.addEventListener("change", () => { const v = val("primerMode"); save("primerMode", v); updateModeVisibility(v); });
  $("primerActiveStart")?.addEventListener("change", () => save("primerActiveStart", val("primerActiveStart")));
  $("primerActiveEnd")?.addEventListener("change", () => save("primerActiveEnd", val("primerActiveEnd")));
  $("primerJitterSeconds")?.addEventListener("change", () => save("primerJitterSeconds", Math.max(0, Math.min(120, Number(val("primerJitterSeconds")) || 0))));
  $("primerTimes")?.addEventListener("change", () => save("primerTimes", parseList(val("primerTimes"))));
  $("primerOffDays")?.addEventListener("change", () => save("primerOffDays", parseList(val("primerOffDays")).map(Number).filter((n) => n >= 0 && n <= 6)));
  $("primerTestBtn")?.addEventListener("click", () => {
    const el = $("primerStatus"); if (el) el.textContent = "sending…";
    chrome.runtime.sendMessage({ type: "aleph-primer-run-now" }, () => refreshStatus());
  });
}
