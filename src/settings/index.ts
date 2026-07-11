import { bindEvents, loadUI } from "./controls";
import { bindSyncEvents, loadSyncStatus } from "./syncUi";
import { bindAntigravityEvents, loadAntigravityStatus } from "./antigravityUi";
import { bindPrimerEvents, loadPrimerUI } from "./primerUi";

document.addEventListener("DOMContentLoaded", () => {
  loadUI();
  bindEvents();
  loadSyncStatus();
  bindSyncEvents();
  loadAntigravityStatus();
  bindAntigravityEvents();
  loadPrimerUI();
  bindPrimerEvents();
});
