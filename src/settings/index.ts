import { bindEvents, loadUI } from "./controls";
import { bindSyncEvents, loadSyncStatus } from "./syncUi";

document.addEventListener("DOMContentLoaded", () => {
  loadUI();
  bindEvents();
  loadSyncStatus();
  bindSyncEvents();
});
