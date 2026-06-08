import { PRICING } from "../shared/pricing";
import { send } from "./send";
import type { Platform } from "../shared/platform";

// ── Subscription & model detection ───────────────────────

export type ClaudePlan = "free" | "pro" | "max5x" | "max20x";
export type ChatgptPlan = "free" | "plus" | "pro5x" | "pro20x";
export type GeminiPlan = "free" | "ai_plus" | "ai_pro" | "ai_ultra";

export interface PlanDetection {
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

export function detectClaudeSubscription(): PlanDetection {
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

export function collectChatgptPlanSignals(value: unknown, depth = 0, includeChildren = false): string[] {
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
  // "prolite" is a real ChatGPT planType ($100 tier) that the \bpro\b check
  // below misses — "pro" has no trailing word boundary inside "prolite". Match
  // the pro-lite/pro_lite spellings too.
  if (/\bpro[\s_-]?lite\b/.test(text)) return "pro5x";
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

export function detectChatgptSubscription(): PlanDetection {
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

// Gemini's account tier badge (`.mavatar-tier-label`) renders the plan's last
// word — "Pro", "Ultra", "Plus" (or legacy "Advanced"). Pure, so it is
// unit-tested. Returns null for an absent/unrecognized label so the caller can
// avoid clobbering a known plan with a guess.
export function geminiPlanFromTierLabel(label: string | null | undefined): GeminiPlan | null {
  const t = (label || "").trim();
  if (!t) return null;
  if (/ultra/i.test(t)) return "ai_ultra";
  if (/plus/i.test(t)) return "ai_plus";
  if (/pro|advanced/i.test(t)) return "ai_pro";
  if (/^free$/i.test(t)) return "free";
  return null;
}

export function detectGeminiSubscription(): PlanDetection | null {
  // The account tier badge is the only authoritative signal. Free is asserted
  // ONLY by an explicit "Free" label — never by the absence of a badge or the
  // presence of an upgrade CTA (paid users get upsold too). Returning null on an
  // unknown/missing badge leaves any previously-stored plan untouched
  // (sendSubscriptionDetection drops null), so a transient DOM miss cannot
  // downgrade a paying user to $0.
  const label = document.querySelector(".mavatar-tier-label")?.textContent?.trim() || "";
  const model =
    document.querySelector('[data-test-id="bard-mode-menu-button"]')?.textContent?.trim() ||
    document.querySelector("bard-mode-switcher")?.textContent?.trim() ||
    null;
  const plan = geminiPlanFromTierLabel(label);
  return plan ? { plan, model } : null;
}

export function sendSubscriptionDetection(platform: Platform, result: PlanDetection | null) {
  try {
    if (!result) return;

    const pricing = PRICING[platform][result.plan];
    send({
      type: "insights-subscription",
      platform,
      plan: result.plan,
      model: result.model,
      price: pricing ? pricing.price : 0,
      label: pricing ? pricing.label : result.plan,
    });
  } catch (e) {}
}
