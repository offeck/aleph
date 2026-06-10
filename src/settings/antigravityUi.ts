// ── Antigravity (settings: logout only) ──────────────────
// Login lives in the popup; the settings page only shows the connected account
// and the Disconnect (logout) control. Connect status arrives as raw JSON from
// the background — boundary `any`.
function setDisplay(id: string, show: boolean) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "" : "none";
}

function renderAntigravityStatus(status: any) {
  const connected = Boolean(status && status.connected);
  const configured = Boolean(status && status.configured);
  // Inert build (no client secret) with nothing connected: nothing actionable —
  // hide the whole section rather than offer a Connect button that only throws.
  setDisplay("antigravitySection", configured || connected);
  setDisplay("antigravityConnected", connected);
  setDisplay("antigravityDisconnected", !connected);
  if (connected) {
    const email = document.getElementById("antigravityEmail");
    if (email) email.textContent = status.email || "your Google account";
  }
}

export function loadAntigravityStatus() {
  chrome.runtime.sendMessage({ type: "aleph-antigravity-status" }, renderAntigravityStatus);
}

export function bindAntigravityEvents() {
  // Connect is also offered here (popup is primary, but this is the fallback for
  // users who dismissed the popup prompt). Opens the same consent flow.
  document.getElementById("antigravityConnectBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("antigravityConnectBtn") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Opening Google…";
    chrome.runtime.sendMessage({ type: "aleph-antigravity-connect" }, (res: any) => {
      btn.disabled = false;
      btn.textContent = "Connect Antigravity";
      if (res && res.started === false && res.error) btn.title = res.error;
    });
  });

  document.getElementById("antigravityDisconnectBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "aleph-antigravity-disconnect" }, () => loadAntigravityStatus());
  });

  // Reflect a popup connect/disconnect live (the token write lands in local storage).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.insights_antigravity_auth) loadAntigravityStatus();
  });
}
