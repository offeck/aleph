import { DEFAULTS } from "../shared/defaults";

const $ = (id: string) => document.getElementById(id);
const val = (id: string) => ($(id) as HTMLInputElement | null)?.value ?? "";
const checked = (id: string) => ($(id) as HTMLInputElement | null)?.checked ?? false;

const TOGGLES = [
  "primerEnabled", "primerActiveHoursEnabled", "primerTargetClaude",
  "primerTargetCodex", "primerAutoDeleteClaude", "primerJitterEnabled",
] as const;
const TEXTS = ["primerMode", "primerActiveStart", "primerActiveEnd", "primerJitterSeconds"] as const;

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let offDays: number[] = [];
let times: string[] = [];

function isValidHHMM(s: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function save(key: string, value: unknown) { chrome.storage.sync.set({ [key]: value }); }

// Half-hour options ("00:00", "00:30" … "23:30") for the time dropdowns.
function timeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    out.push(`${hh}:00`, `${hh}:30`);
  }
  return out;
}

function fillTimeSelect(sel: HTMLSelectElement | null, placeholder?: string) {
  if (!sel || sel.options.length) return;
  if (placeholder) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = placeholder; o.selected = true;
    sel.appendChild(o);
  }
  for (const t of timeOptions()) {
    const o = document.createElement("option");
    o.value = t; o.textContent = t;
    sel.appendChild(o);
  }
}

function updateModeVisibility(mode: string) {
  const smart = mode === "smart";
  const s = $("primerSmartFields"); if (s) s.style.display = smart ? "" : "none";
  const sc = $("primerScheduledFields"); if (sc) sc.style.display = smart ? "none" : "";
  const risk = $("primerSmartRisk"); if (risk) risk.style.display = smart ? "" : "none";
}

// ── Off-days: tap-to-toggle day-of-week picker ─────────────────────
function renderDays() {
  const c = $("primerOffDays");
  if (!c) return;
  c.textContent = "";
  DAY_LABELS.forEach((label, day) => {
    const off = () => offDays.includes(day);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day-chip" + (off() ? " off" : "");
    b.textContent = label;
    b.title = DAY_NAMES[day] + (off() ? " — off" : "");
    b.addEventListener("click", () => {
      offDays = off() ? offDays.filter((d) => d !== day) : [...offDays, day].sort((x, y) => x - y);
      save("primerOffDays", offDays);
      b.classList.toggle("off", off());
      b.title = DAY_NAMES[day] + (off() ? " — off" : "");
    });
    c.appendChild(b);
  });
}

// ── Scheduled daily-times: time picker + removable chips ───────────
function renderTimes() {
  const c = $("primerTimesChips");
  if (!c) return;
  c.textContent = "";
  if (!times.length) {
    const empty = document.createElement("span");
    empty.className = "time-empty";
    empty.textContent = "no times yet — add one above";
    c.appendChild(empty);
    return;
  }
  times.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "time-chip";
    chip.textContent = t;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "time-chip-x";
    x.textContent = "×";
    x.title = "Remove " + t;
    x.addEventListener("click", () => {
      times = times.filter((tt) => tt !== t);
      save("primerTimes", times);
      renderTimes();
    });
    chip.appendChild(x);
    c.appendChild(chip);
  });
}

function addTime() {
  const sel = $("primerTimeInput") as HTMLSelectElement | null;
  const v = sel?.value;
  if (v && isValidHHMM(v) && !times.includes(v)) {
    times = [...times, v].sort();
    save("primerTimes", times);
    renderTimes();
  }
  if (sel) sel.value = "";
}

export function loadPrimerUI(): void {
  fillTimeSelect($("primerTimeInput") as HTMLSelectElement | null, "Pick a time…");
  fillTimeSelect($("primerActiveStart") as HTMLSelectElement | null);
  fillTimeSelect($("primerActiveEnd") as HTMLSelectElement | null);
  chrome.storage.sync.get(DEFAULTS, (s) => {
    TOGGLES.forEach((k) => { const el = $(k) as HTMLInputElement | null; if (el) el.checked = Boolean(s[k]); });
    TEXTS.forEach((k) => { const el = $(k) as HTMLInputElement | null; if (el) el.value = String(s[k]); });
    offDays = Array.isArray(s.primerOffDays) ? [...s.primerOffDays] : [];
    times = Array.isArray(s.primerTimes) ? [...s.primerTimes] : [];
    renderDays();
    renderTimes();
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
  TOGGLES.forEach((k) => $(k)?.addEventListener("change", () => save(k, checked(k))));
  $("primerMode")?.addEventListener("change", () => { const v = val("primerMode"); save("primerMode", v); updateModeVisibility(v); });
  $("primerActiveStart")?.addEventListener("change", () => save("primerActiveStart", val("primerActiveStart")));
  $("primerActiveEnd")?.addEventListener("change", () => save("primerActiveEnd", val("primerActiveEnd")));
  $("primerJitterSeconds")?.addEventListener("change", () => save("primerJitterSeconds", Math.max(0, Math.min(120, Number(val("primerJitterSeconds")) || 0))));
  $("primerTimeAdd")?.addEventListener("click", addTime);
  $("primerTimeInput")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); addTime(); } });
  $("primerTestBtn")?.addEventListener("click", () => {
    const el = $("primerStatus"); if (el) el.textContent = "sending…";
    chrome.runtime.sendMessage({ type: "aleph-primer-run-now" }, () => refreshStatus());
  });
}
