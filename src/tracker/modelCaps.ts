import { send } from "./send";

export function getChatgptCurrentModel(): string | null {
  try {
    const c = document.cookie.split(";").reduce((a, c) => { const [k,...v] = c.trim().split("="); a[k]=v.join("="); return a; }, {} as Record<string, string>);
    if (c["oai-last-model-config"]) return JSON.parse(decodeURIComponent(c["oai-last-model-config"])).model || "auto";
  } catch (e) {}
  return null;
}

// ── Model capabilities enrichment ──────────────────────
// Fetches available models + capabilities from each platform's API.
let capabilitiesFetched = false;

function beginModelCapabilitiesPoll() {
  if (capabilitiesFetched) return false;
  capabilitiesFetched = true;
  return true;
}

export function pollClaudeModelCapabilities() {
  if (!beginModelCapabilitiesPoll()) return;
  try {
    const cookies = document.cookie.split(";").reduce((a, c) => {
      const [k, ...v] = c.trim().split("="); a[k] = v.join("="); return a;
    }, {} as Record<string, string>);
    const orgId = cookies["lastActiveOrg"];
    if (!orgId) return;
    const modelBtn = document.querySelector('[data-testid="model-selector-dropdown"]');
    const ariaLabel = modelBtn?.getAttribute("aria-label") || "";
    const modelSlug = ariaLabel.replace(/^Model:\s*/i, "").trim().toLowerCase().replace(/\s+/g, "-");
    const apiSlug = "claude-" + modelSlug.replace(/extended$/i, "").replace(/-$/, "").replace(/\./g, "-");
    fetch("/api/organizations/" + orgId + "/model_configs/" + apiSlug, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((cfg) => {
        if (!cfg) return;
        send({ type: "insights-model-caps", platform: "claude", caps: {
          apiModel: cfg.api_model, maxTokens: cfg.max_tokens_cap,
          imageIn: cfg.image_in, pdfIn: cfg.pdf_in,
        }});
      }).catch(() => {});
  } catch (e) {}
}

export function pollChatgptModelCapabilities() {
  if (!beginModelCapabilitiesPoll()) return;
  try {
    fetch("/backend-api/models?iim=false&is_gizmo=false", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.models) return;
        const models = data.models.map((m: Record<string, unknown>) => ({
          slug: m.slug, title: m.title, maxTokens: m.max_tokens,
          tools: m.enabled_tools,
        }));
        send({ type: "insights-model-caps", platform: "chatgpt", caps: { availableModels: models } });
      }).catch(() => {});
  } catch (e) {}
}
