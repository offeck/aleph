// ── Antigravity (settings: secret entry + logout) ────────
// The borrowed-client secret is user-supplied — it's entered here (never shipped
// in the bundle) and saved to a local-only key. Once a secret is saved the popup
// offers Connect (login); this page also offers Connect as a fallback and owns the
// Disconnect (logout). Connect status arrives as raw JSON from the background —
// boundary `any`.
function setDisplay(id: string, show: boolean) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "" : "none";
}

function renderAntigravityStatus(status: any) {
  const connected = Boolean(status && status.connected);
  const configured = Boolean(status && status.configured); // a secret is saved
  setDisplay("antigravitySecretSavedRow", configured);
  setDisplay("antigravityConnected", connected);
  // Offer Connect only once a secret is saved and we're not already connected.
  setDisplay("antigravityDisconnected", configured && !connected);
  if (connected) {
    const email = document.getElementById("antigravityEmail");
    if (email) email.textContent = status.email || "your Google account";
  }
}

export function loadAntigravityStatus() {
  chrome.runtime.sendMessage({ type: "aleph-antigravity-status" }, renderAntigravityStatus);
}

export function bindAntigravityEvents() {
  const input = document.getElementById("antigravitySecretInput") as HTMLInputElement | null;

  const saveSecret = () => {
    const secret = (input?.value || "").trim();
    if (!secret) { input?.focus(); return; }
    const btn = document.getElementById("antigravitySecretSaveBtn") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Saving…";
    chrome.runtime.sendMessage({ type: "aleph-antigravity-set-secret", secret }, () => {
      btn.disabled = false;
      btn.textContent = "Save";
      if (input) input.value = ""; // never leave the secret sitting in the field
      loadAntigravityStatus();
    });
  };

  document.getElementById("antigravitySecretSaveBtn")?.addEventListener("click", saveSecret);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") saveSecret(); });

  document.getElementById("antigravitySecretClearBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "aleph-antigravity-set-secret", secret: "" }, () => {
      if (input) input.value = "";
      loadAntigravityStatus();
    });
  });

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

  // Reflect a popup connect/disconnect or a secret change live (both land in local
  // storage).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.insights_antigravity_auth || changes.insights_antigravity_secret)) loadAntigravityStatus();
  });
}
