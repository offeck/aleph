import { PRICING } from "../shared/pricing";
import { send } from "./send";
import { PLATFORM } from "./platform";

// ── Subscription & model detection ───────────────────────

export type ClaudePlan = "free" | "pro" | "max5x" | "max20x";
export type ChatgptPlan = "free" | "plus" | "pro5x" | "pro20x";
export type GeminiPlan = "free" | "ai_pro" | "ai_ultra";

interface PlanDetection {
  plan: string;
  model: string | null;
}

function parseCookies(): Record<string, string> {
  return document.cookie.split(";").reduce((a, c) => {
    const [k, ...v] = c.trim().split("=");
    a[k] = v.join("=");
    return a;
  }, {} as Record<string, string>);
}

// Claude: primary detection via /api/organizations/{orgId} (uses session cookie, no API key).
// Returns rate_limit_tier like "default_claude_max_20x", "default_claude_pro", etc.
let claudeApiPlan: ClaudePlan | null = null;
export function detectClaudeViaApi() {
  if (claudeApiPlan) return;
  try {
    const cookies = parseCookies();
    const orgId = cookies["lastActiveOrg"];
    if (!orgId) return;
    fetch("/api/organizations/" + orgId, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.rate_limit_tier) return;
        const tier = data.rate_limit_tier;
        if (/max_20x/i.test(tier)) claudeApiPlan = "max20x";
        else if (/max_5x/i.test(tier)) claudeApiPlan = "max5x";
        else if (/max/i.test(tier)) claudeApiPlan = "max5x";
        else if (/pro/i.test(tier)) claudeApiPlan = "pro";
        else claudeApiPlan = "free";
      })
      .catch(() => {});
  } catch (e) {}
}

function detectClaude(): PlanDetection {
  const modelBtn = document.querySelector('[data-testid="model-selector-dropdown"]');
  const ariaLabel = modelBtn?.getAttribute("aria-label") || "";
  const model = ariaLabel.replace(/^Model:\s*/i, "").trim() || null;

  // Use API result if available (most reliable)
  if (claudeApiPlan) return { plan: claudeApiPlan, model };

  // DOM fallback: user-menu-button shows "Max plan", "Pro", etc.
  const menuBtn = document.querySelector('[data-testid="user-menu-button"]');
  const menuText = menuBtn?.textContent || "";
  if (/max\s*plan/i.test(menuText)) {
    const pageText = document.body.innerText || "";
    if (/20x/i.test(pageText)) return { plan: "max20x", model };
    return { plan: "max5x", model };
  }

  const hasUpgrade = document.querySelector(
    "[data-testid='nav-upgrade'], [data-testid='upgrade-button']"
  );
  if (hasUpgrade) return { plan: "free", model };

  if (/\bpro\b/i.test(menuText)) return { plan: "pro", model };
  return { plan: model && /opus/i.test(model) ? "pro" : "free", model };
}

// ChatGPT: detect plan via /api/auth/session which returns the real plan_type
// with just cookies (no bearer token needed for this endpoint).
// Also retrieves the access token needed for usage polling.
let chatgptApiPlan: ChatgptPlan | null = null;
export const CHATGPT_PLAN_RANK: Record<ChatgptPlan, number> = { free: 0, plus: 1, pro5x: 2, pro20x: 3 };

function setChatgptApiPlan(plan: ChatgptPlan | null) {
  if (!plan) return;
  if (!chatgptApiPlan || (CHATGPT_PLAN_RANK[plan] || 0) > (CHATGPT_PLAN_RANK[chatgptApiPlan] || 0)) {
    chatgptApiPlan = plan;
  }
}

function collectChatgptPlanSignals(value: unknown, depth = 0, includeChildren = false): string[] {
  if (!value || depth > 3) return [];
  if (typeof value !== "object") return [String(value)];
  const signals: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const relevantKey = /plan|tier|billing|subscription|price|amount|product|sku|seat|license|account|workspace/i.test(key);
    if (!includeChildren && !relevantKey) continue;
    if (child && typeof child === "object") {
      const isPlanContainer = /plan|tier|billing|subscription|product|sku|seat|license/i.test(key);
      signals.push(...collectChatgptPlanSignals(child, depth + 1, includeChildren || isPlanContainer));
    } else if (child != null) {
      signals.push(key + ":" + String(child));
    }
  }
  return signals;
}

// Known ChatGPT price points only. Plus ($20) is detected via text, not price,
// to avoid collisions with junk numerics. Bands cover dollars and cents-encoded
// forms (n/100). Returns a plan string or null — never a bare number.
export function planFromPriceNumber(n: number): ChatgptPlan | null {
  if (!Number.isFinite(n)) return null;
  for (const v of [n, n / 100]) {
    if (v >= 190 && v <= 260) return "pro20x";
    if (v >= 90 && v <= 130) return "pro5x";
  }
  return null;
}

// Only unambiguous price-ish keys: bare price/cost, or qualified amount/monthly
// forms (billing_amount, amount_due, price_cents...). Bare amount/monthly are
// intentionally excluded (credit_amount etc. are not prices).
const CHATGPT_PRICE_KEY_RE =
  /(?:\b(?:price|cost)\b|(?:billing|monthly|unit|plan|sub|subscription)[_-]?(?:price|amount|cost)|amount[_-](?:due|cents|usd|total|gross|net)|(?:price|amount)[_-]?cents)[a-z0-9_.:= -]{0,40}?(\d+(?:\.\d+)?)/gi;

function extractChatgptPlanPrice(text: string): ChatgptPlan | null {
  CHATGPT_PRICE_KEY_RE.lastIndex = 0;
  let best: ChatgptPlan | null = null;
  let match;
  while ((match = CHATGPT_PRICE_KEY_RE.exec(text))) {
    const plan = planFromPriceNumber(Number(match[1]));
    if (plan === "pro20x") return "pro20x";
    if (plan === "pro5x") best = "pro5x";
  }
  return best;
}

export function normalizeChatgptPlan(raw: string | null | undefined, context: { signals?: string[] } = {}): ChatgptPlan | null {
  const text = [raw, ...(context.signals || [])].filter(Boolean).join(" ").toLowerCase();
  const pricePlan = extractChatgptPlanPrice(text);
  if (pricePlan) return pricePlan;
  if (/\$[\s ]*200\b|\b200\s*usd\b|\b20x\b|\bpro[_ -]?20x?\b|\b(?:price|cost|billing[_ -]?amount|amount[_ -]due|monthly[_ -]price|subscription)[a-z0-9_:= -]{0,80}200\b/.test(text)) return "pro20x";
  if (/\$[\s ]*100\b|\b100\s*usd\b|\b5x\b|\bpro[_ -]?5x?\b|\b(?:price|cost|billing[_ -]?amount|amount[_ -]due|monthly[_ -]price|subscription)[a-z0-9_:= -]{0,80}100\b/.test(text)) return "pro5x";
  if (/\bpro\b/.test(text)) return "pro5x";
  if (/\bplus\b/.test(text)) return "plus";
  if (/\bfree\b|\bgo\b/.test(text)) return "free";
  return null;
}

function detectChatgptDomPlan() {
  const profileText = Array.from(document.querySelectorAll('[data-testid="accounts-profile-button"]'))
    .map((profile) => [profile.textContent, profile.getAttribute("aria-label")].filter(Boolean).join(" "))
    .join(" ");
  if (!profileText) return null;
  if (/\bpro\b/i.test(profileText)) {
    return normalizeChatgptPlan(profileText) || "pro5x";
  }
  return normalizeChatgptPlan(profileText);
}

// ── ChatGPT auth token (shared with usage polling) ────────
// Two-step auth: /api/auth/session returns a bearer token (works with cookies),
// then /backend-api/conversation/init with that token returns real limits.
// Without the token, the API returns guest data even for Plus users.
let chatgptAccessToken: string | null = null;

export function getChatgptAccessToken(): string | null {
  return chatgptAccessToken;
}

export function refreshChatgptToken() {
  return fetch("/api/auth/session", { credentials: "same-origin" })
    .then((r) => r.ok ? r.json() : null)
    .then((session) => {
      if (session?.accessToken) chatgptAccessToken = session.accessToken;
      if (session?.account && !chatgptApiPlan) {
        const plan = normalizeChatgptPlan(session.account.planType, {
          signals: collectChatgptPlanSignals(session.account),
        });
        setChatgptApiPlan(plan);
      }
      return chatgptAccessToken;
    })
    .catch(() => null);
}

export function detectChatgptViaApi() {
  if (chatgptApiPlan) return;
  refreshChatgptToken().then((token) => {
    if (!token) {
      // Fallback: infer from model cookie
      try {
        const c = parseCookies();
        if (c["oai-last-model-config"]) {
          const m = JSON.parse(decodeURIComponent(c["oai-last-model-config"])).model || "";
          if (/^o3$/.test(m)) setChatgptApiPlan("pro5x");
          else if (/^gpt-5-[2-9]|^gpt-5-5/.test(m)) setChatgptApiPlan("plus");
        }
      } catch (e) {}
    }
  });
}

function detectChatgpt(): PlanDetection {
  let model: string | null = null;

  try {
    const cookies = parseCookies();
    if (cookies["oai-last-model-config"]) {
      const cfg = JSON.parse(decodeURIComponent(cookies["oai-last-model-config"]));
      model = cfg.model || null;
    }
  } catch (e) {}

  if (chatgptApiPlan) return { plan: chatgptApiPlan, model };

  const domPlan = detectChatgptDomPlan();
  if (domPlan) return { plan: domPlan, model };

  // Cookie-based fallback: infer tier from the selected model
  if (model) {
    if (/^o3$/.test(model)) return { plan: "pro5x", model };
    if (/^gpt-5-5|^gpt-5-[2-9]/.test(model)) return { plan: "plus", model };
    if (/^gpt-5$|^gpt-5-1$/.test(model)) return { plan: "plus", model };
  }

  return { plan: "free", model };
}

function detectGemini(): PlanDetection {
  let plan: GeminiPlan = "free";
  let model: string | null = null;

  // Primary: the mode switch button in the input area shows the active model
  const switchBtn = document.querySelector(".input-area-switch");
  if (switchBtn) {
    model = switchBtn.textContent?.trim() || null;
  }

  // Fallback: old testid (may still exist on some Gemini versions)
  if (!model) {
    const modeBtn = document.querySelector('[data-testid="bard-mode-menu-button"]');
    if (modeBtn) model = modeBtn.textContent?.trim() || null;
  }

  // Model name → plan (handles Hebrew UI: "מעמיק"=Deep Research, "Pro" stays English)
  if (model) {
    if (/ultra|advanced/i.test(model)) plan = "ai_ultra";
    else if (/\bpro\b/i.test(model) || model === "מעמיק") plan = "ai_pro";
  }

  // Tier from mode picker: Pro/Deep modes only available to paid users
  if (plan === "free") {
    const modeItems = document.querySelectorAll('[role="menuitem"]');
    for (const item of modeItems) {
      const t = item.textContent || "";
      if (/\bpro\b/i.test(t) || t.includes("מעמיק")) {
        plan = "ai_pro";
        break;
      }
    }
  }

  // Final fallback: no upgrade button means paid user
  if (plan === "free") {
    const hasUpgrade = document.querySelector(
      "[class*='upgrade' i], [class*='premium' i], [aria-label*='upgrade' i]"
    );
    if (!hasUpgrade && model) plan = "ai_pro";
  }
  return { plan, model };
}

export function detectSubscription() {
  try {
    let result: PlanDetection | null = null;
    if (PLATFORM === "claude") result = detectClaude();
    else if (PLATFORM === "chatgpt") result = detectChatgpt();
    else if (PLATFORM === "gemini") result = detectGemini();
    if (!result) return;

    const pricing = PRICING[PLATFORM][result.plan];
    send({
      type: "insights-subscription",
      platform: PLATFORM,
      plan: result.plan,
      model: result.model,
      price: pricing ? pricing.price : 0,
      label: pricing ? pricing.label : result.plan,
    });
  } catch (e) {}
}
