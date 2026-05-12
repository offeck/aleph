(function () {
  "use strict";

  const host = location.hostname;
  const PLATFORM =
    host.includes("claude.ai") ? "claude" :
    host.includes("chatgpt.com") || host.includes("chat.openai.com") ? "chatgpt" :
    host.includes("gemini.google.com") ? "gemini" :
    null;
  if (!PLATFORM) return;

  // ── Pricing ──────────────────────────────────────────────
  const PRICING = {
    claude:  { free: { price: 0, label: "Free" }, pro: { price: 20, label: "Pro" }, max5x: { price: 100, label: "Max 5x" }, max20x: { price: 200, label: "Max 20x" } },
    chatgpt: { free: { price: 0, label: "Free" }, plus: { price: 20, label: "Plus" }, pro: { price: 200, label: "Pro" } },
    gemini:  { free: { price: 0, label: "Free" }, ai_pro: { price: 19.99, label: "AI Pro" }, ai_ultra: { price: 249.99, label: "AI Ultra" } },
  };

  // ── Message selectors (minimal duplication from content.js) ──
  const MSG_CONTAINER = {
    claude:  ["main", "[data-testid='chat-messages']"],
    chatgpt: ["main"],
    gemini:  [".conversation-container", "chat-app"],
  };
  const MSG_WRAPPER = {
    claude:  ["[data-testid='chat-message']"],
    chatgpt: ["[data-testid^='conversation-turn']"],
    gemini:  ["model-response", ".conversation-turn"],
  };
  const ASSISTANT_MARKER = {
    claude:  [".font-claude-response", "[data-testid='chat-message-content']"],
    chatgpt: ["[data-message-author-role='assistant']"],
    gemini:  [".response-content", ".model-response-text", "message-content"],
  };
  const USER_MARKER = {
    claude:  ["[data-testid='chat-message-user']", ".font-user-message"],
    chatgpt: ["[data-message-author-role='user']"],
    gemini:  [".query-content", ".user-query"],
  };

  // ── Helpers ──────────────────────────────────────────────
  function send(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (e) {}
  }

  // Chars-per-token ratios tuned per platform tokenizer and content type.
  // Claude uses a custom BPE tokenizer, ChatGPT uses tiktoken (o200k_base),
  // Gemini uses SentencePiece — each handles Hebrew, code, and Latin differently.
  // Whitespace/punctuation tokenize at ~1 token per character on all platforms.
  const TOKEN_RATIOS = {
    claude:  { latin: 3.8, hebrew: 2.0, code: 2.8, whitespace: 5.0 },
    chatgpt: { latin: 4.0, hebrew: 1.7, code: 2.5, whitespace: 5.5 },
    gemini:  { latin: 4.2, hebrew: 2.2, code: 3.0, whitespace: 5.0 },
  };

  function estimateTokens(text) {
    if (!text) return 0;
    const ratios = TOKEN_RATIOS[PLATFORM] || TOKEN_RATIOS.chatgpt;

    let tokens = 0;

    // Extract code blocks first — they tokenize differently (operators, indentation)
    const codeBlocks = [];
    const withoutCode = text.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
      codeBlocks.push(m);
      return "";
    });
    for (const block of codeBlocks) {
      tokens += block.length / ratios.code;
    }

    // Split remaining into Hebrew, Latin words, and whitespace/punctuation
    const hebrewChars = (withoutCode.match(/[֐-׿؀-ۿ]/g) || []).length;
    const wsChars = (withoutCode.match(/[\s\n\r\t]+/g) || []).join("").length;
    const latinChars = withoutCode.length - hebrewChars - wsChars;

    tokens += hebrewChars / ratios.hebrew;
    tokens += latinChars / ratios.latin;
    tokens += wsChars / ratios.whitespace;

    return Math.ceil(tokens);
  }

  function q(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  // ── Time tracking ────────────────────────────────────────
  let isActive = document.visibilityState === "visible" && document.hasFocus();
  let lastTickTime = isActive ? Date.now() : null;
  let pendingSeconds = 0;
  const FLUSH_INTERVAL = 30000;

  function activate() {
    if (isActive) return;
    isActive = true;
    lastTickTime = Date.now();
  }

  function deactivate() {
    if (!isActive) return;
    tick();
    flush();
    isActive = false;
    lastTickTime = null;
  }

  function tick() {
    if (!isActive || !lastTickTime) return;
    const now = Date.now();
    const delta = Math.min((now - lastTickTime) / 1000, 5);
    if (delta > 0) pendingSeconds += delta;
    lastTickTime = now;
  }

  function flush() {
    if (pendingSeconds < 1) return;
    const seconds = Math.round(pendingSeconds);
    pendingSeconds = 0;
    send({
      type: "insights-time",
      platform: PLATFORM,
      seconds,
      hour: new Date().getHours(),
    });
  }

  document.addEventListener("visibilitychange", () => {
    document.visibilityState === "visible" ? activate() : deactivate();
  });
  window.addEventListener("focus", activate);
  window.addEventListener("blur", deactivate);
  window.addEventListener("beforeunload", () => { tick(); flush(); });

  setInterval(tick, 1000);
  setInterval(flush, FLUSH_INTERVAL);

  // ── Message counting + token estimation ──────────────────
  const countedMessages = new WeakSet();

  function classifyMessage(el) {
    for (const s of ASSISTANT_MARKER[PLATFORM]) {
      if (el.matches?.(s) || el.querySelector?.(s)) return "assistant";
    }
    for (const s of USER_MARKER[PLATFORM]) {
      if (el.matches?.(s) || el.querySelector?.(s)) return "user";
    }
    return null;
  }

  function processNewMessage(el) {
    if (countedMessages.has(el)) return;
    countedMessages.add(el);
    const role = classifyMessage(el);
    if (!role) return;
    const text = el.textContent || "";
    send({
      type: "insights-message",
      platform: PLATFORM,
      role,
      estimatedTokens: estimateTokens(text),
    });
  }

  function scanExistingMessages() {
    for (const sel of MSG_WRAPPER[PLATFORM]) {
      document.querySelectorAll(sel).forEach(processNewMessage);
    }
  }

  function startMessageObserver() {
    const container = q(MSG_CONTAINER[PLATFORM]);
    if (!container) return;
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const sel of MSG_WRAPPER[PLATFORM]) {
            if (node.matches?.(sel)) { processNewMessage(node); continue; }
            node.querySelectorAll?.(sel).forEach(processNewMessage);
          }
        }
      }
    }).observe(container, { childList: true, subtree: true });
  }

  // ── Subscription & model detection ───────────────────────

  // Claude: primary detection via /api/organizations/{orgId} (uses session cookie, no API key).
  // Returns rate_limit_tier like "default_claude_max_20x", "default_claude_pro", etc.
  let claudeApiPlan = null;
  function detectClaudeViaApi() {
    if (claudeApiPlan) return;
    try {
      const cookies = document.cookie.split(";").reduce((a, c) => {
        const [k, ...v] = c.trim().split("=");
        a[k] = v.join("=");
        return a;
      }, {});
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

  function detectClaude() {
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

  // ChatGPT: primary detection via /backend-api/accounts/check (session cookie only).
  // Returns subscription_plan like "chatgptplusplan", "chatgptproplan", "chatgptguestplan".
  let chatgptApiPlan = null;
  function detectChatgptViaApi() {
    if (chatgptApiPlan) return;
    fetch("/backend-api/accounts/check/v4-2023-04-27", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const sub = data?.accounts?.default?.entitlement?.subscription_plan || "";
        if (/plusplan/i.test(sub)) chatgptApiPlan = "plus";
        else if (/proplan/i.test(sub)) chatgptApiPlan = "pro";
        else chatgptApiPlan = "free";
      })
      .catch(() => {});
  }

  function detectChatgpt() {
    let model = null;

    try {
      const cookies = document.cookie.split(";").reduce((acc, c) => {
        const [k, ...v] = c.trim().split("=");
        acc[k] = v.join("=");
        return acc;
      }, {});
      if (cookies["oai-last-model-config"]) {
        const cfg = JSON.parse(decodeURIComponent(cookies["oai-last-model-config"]));
        model = cfg.model || null;
      }
    } catch (e) {}

    // Use API result if available (most reliable)
    if (chatgptApiPlan) return { plan: chatgptApiPlan, model };

    // DOM fallback: profile button text ends with plan name
    const profileBtn = document.querySelector('[data-testid="accounts-profile-button"]');
    const profileText = profileBtn?.textContent?.trim() || "";
    let plan = "free";
    if (/Plus$/i.test(profileText)) plan = "plus";
    else if (/Pro$/i.test(profileText)) plan = "pro";

    return { plan, model };
  }

  function detectGemini() {
    let plan = "free";
    let model = null;

    const allBtns = document.querySelectorAll("button");
    for (const b of allBtns) {
      const t = b.textContent?.trim();
      if (!t || t.length > 60) continue;
      if (/gemini|flash|pro|ultra/i.test(t) && !/setting|prefer|option/i.test(t)) {
        model = t;
        break;
      }
    }

    if (model) {
      if (/ultra|advanced/i.test(model)) plan = "ai_ultra";
      else if (/pro/i.test(model)) plan = "ai_pro";
    }

    if (plan === "free") {
      const hasUpgrade = document.querySelector(
        "[class*='upgrade' i], [class*='premium' i], [aria-label*='upgrade' i]"
      );
      if (!hasUpgrade && model) plan = "ai_pro";
    }
    return { plan, model };
  }

  function detectSubscription() {
    try {
      let result = null;
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

  // ── Boot ─────────────────────────────────────────────────
  if (PLATFORM === "claude") detectClaudeViaApi();
  if (PLATFORM === "chatgpt") detectChatgptViaApi();

  setTimeout(() => {
    detectSubscription();
    scanExistingMessages();
    startMessageObserver();
  }, 3000);

  setInterval(detectSubscription, 60000);
})();
