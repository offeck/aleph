// ── Antigravity connect (popup login) ─────────────────────
// Login lives here in the popup; logout (Disconnect) lives in settings. The
// feature is off by default — the button only appears while not connected and not
// dismissed. A header ⚡ indicator shows once connected (like the cloud sync icon).
// Dismissing hides the prompt for good (Settings stays as the fallback to connect).
// Status arrives as raw JSON from the background — boundary `any`.
const DISMISS_KEY = "insights_antigravity_connect_dismissed";

function setDisplay(id: string, show: boolean) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "" : "none";
}

export function loadAntigravityConnect() {
  chrome.storage.local.get({ [DISMISS_KEY]: false }, (s) => {
    const dismissed = Boolean(s[DISMISS_KEY]);
    chrome.runtime.sendMessage({ type: "aleph-antigravity-status" }, (status: any) => {
      if (chrome.runtime.lastError) return;
      const connected = Boolean(status && status.connected);
      // An inert build (no client secret) can't connect — don't offer the CTA.
      const configured = Boolean(status && status.configured);
      setDisplay("antigravityIndicator", connected);
      setDisplay("antigravityConnectRow", configured && !connected && !dismissed);
      setDisplay("antigravityDismissedHint", false);
    });
  });
}

export function bindAntigravityConnect() {
  const btn = document.getElementById("antigravityConnectBtn") as HTMLButtonElement | null;
  const label = btn?.textContent || "Connect Antigravity";
  btn?.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Opening Google…";
    // The background opens the consent tab and captures the code; the popup
    // typically closes when focus moves to that tab. On reopen, status reflects it.
    // If the connect couldn't even start (inert build, or the tab failed to open),
    // recover the button and show why rather than leaving it stuck on "Opening…".
    chrome.runtime.sendMessage({ type: "aleph-antigravity-connect" }, (res: any) => {
      const failed = chrome.runtime.lastError || (res && res.started === false);
      if (!failed) return;
      btn.disabled = false;
      btn.textContent = label;
      if (res && res.error) btn.title = res.error;
    });
  });

  document.getElementById("antigravityDismissBtn")?.addEventListener("click", () => {
    chrome.storage.local.set({ [DISMISS_KEY]: true });
    setDisplay("antigravityConnectRow", false);
    setDisplay("antigravityDismissedHint", true);
    setTimeout(() => setDisplay("antigravityDismissedHint", false), 4000);
  });

  // Re-render on connect/disconnect (token write) or a dismiss toggle on another view.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.insights_antigravity_auth || changes[DISMISS_KEY])) loadAntigravityConnect();
  });
}
