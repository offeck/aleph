import { loadInsights } from "./insightsView";
import { bindEvents, detectActivePlatform, loadSyncIndicator, loadUI } from "./ui";

document.addEventListener("DOMContentLoaded", () => {
  loadUI();
  bindEvents();
  loadInsights();
  detectActivePlatform();
  loadSyncIndicator();
});
