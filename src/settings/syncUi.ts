// ── Cloud Sync UI ────────────────────────────────────────
// Sync auth state arrives as raw JSON from the background — boundary `any`.
function updateSyncUI(state: any) {
  const signedOut = document.getElementById("syncSignedOut");
  const signedIn = document.getElementById("syncSignedIn");
  if (!signedOut || !signedIn) return;
  if (state && state.signedIn) {
    signedOut.style.display = "none";
    signedIn.style.display = "";
    document.getElementById("syncEmail")!.textContent = state.email || "unknown";
    const lastTime = document.getElementById("syncLastTime")!;
    if (state.lastSyncAt) {
      lastTime.textContent = "Last sync: " + new Date(state.lastSyncAt).toLocaleString();
    } else {
      lastTime.textContent = "Last sync: never";
    }
  } else {
    signedOut.style.display = "";
    signedIn.style.display = "none";
  }
}

export function loadSyncStatus() {
  chrome.runtime.sendMessage({ type: "aleph-sync-status" }, updateSyncUI);
}

export function bindSyncEvents() {
  document.getElementById("syncSignInBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("syncSignInBtn") as HTMLButtonElement;
    btn.textContent = "Signing in...";
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: "aleph-sync-signin" }, (resp) => {
      btn.textContent = "Sign in with Google";
      btn.disabled = false;
      if (resp?.success) loadSyncStatus();
      else alert("Sign-in failed: " + (resp?.error || "Unknown error"));
    });
  });

  document.getElementById("syncSignOutBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "aleph-sync-signout" }, () => loadSyncStatus());
  });
}
