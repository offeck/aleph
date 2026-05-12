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
    claude:  [".overflow-y-auto", "[class*='max-w-3xl']"],
    chatgpt: ["main"],
    gemini:  [".conversation-container", "chat-app"],
  };
  const MSG_WRAPPER = {
    claude:  ["[data-testid='user-message']", ".font-claude-response"],
    chatgpt: ["[data-testid^='conversation-turn']"],
    gemini:  ["model-response", ".conversation-turn"],
  };
  const ASSISTANT_MARKER = {
    claude:  [".font-claude-response"],
    chatgpt: ["[data-message-author-role='assistant']"],
    gemini:  [".response-content", ".model-response-text", "message-content"],
  };
  const USER_MARKER = {
    claude:  ["[data-testid='user-message']"],
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

  function markExistingMessages() {
    for (const sel of MSG_WRAPPER[PLATFORM]) {
      document.querySelectorAll(sel).forEach((el) => countedMessages.add(el));
    }
  }

  // Observe document.body (not a container that SPAs might replace)
  function startMessageObserver() {
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target.id === "aleph-dynamic-styles") continue;
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const sel of MSG_WRAPPER[PLATFORM]) {
            if (node.matches?.(sel)) { processNewMessage(node); continue; }
            node.querySelectorAll?.(sel).forEach(processNewMessage);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Re-mark existing messages on SPA navigation (URL change within same tab)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      markExistingMessages();
    }
  }, 2000);

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

    // Primary: use the mode menu button which shows the current model/tier
    const modeBtn = document.querySelector('[data-testid="bard-mode-menu-button"]');
    if (modeBtn) {
      model = modeBtn.textContent?.trim() || null;
    }

    // Fallback: scan buttons for model names
    if (!model) {
      const allBtns = document.querySelectorAll("button");
      for (const b of allBtns) {
        const t = b.textContent?.trim();
        if (!t || t.length > 60) continue;
        if (/gemini|flash|pro|ultra/i.test(t) && !/setting|prefer|option/i.test(t)) {
          model = t;
          break;
        }
      }
    }

    if (model) {
      if (/ultra|advanced/i.test(model)) plan = "ai_ultra";
      else if (/\bpro\b/i.test(model)) plan = "ai_pro";
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

  // ── Claude real usage polling ────────────────────────────
  // Fetches /api/organizations/{orgId}/usage with session cookie (no API key).
  // Returns real utilization percentages and reset times.
  function pollClaudeUsage() {
    try {
      const cookies = document.cookie.split(";").reduce((a, c) => {
        const [k, ...v] = c.trim().split("=");
        a[k] = v.join("=");
        return a;
      }, {});
      const orgId = cookies["lastActiveOrg"];
      if (!orgId) return;
      fetch("/api/organizations/" + orgId + "/usage", { credentials: "same-origin" })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return;
          send({
            type: "insights-usage",
            platform: "claude",
            usage: {
              fiveHour: data.five_hour ? { utilization: data.five_hour.utilization, resetsAt: data.five_hour.resets_at } : null,
              sevenDay: data.seven_day ? { utilization: data.seven_day.utilization, resetsAt: data.seven_day.resets_at } : null,
              sonnet: data.seven_day_sonnet ? { utilization: data.seven_day_sonnet.utilization } : null,
              extraUsage: data.extra_usage || null,
            },
          });
        })
        .catch(() => {});
    } catch (e) {}
  }

  // ── ChatGPT real usage polling ───────────────────────────
  // Fetches /backend-api/conversation/init which returns limits_progress
  // and model_limits with remaining counts and reset times.
  function pollChatgptUsage() {
    fetch("/backend-api/conversation/init", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: "{}",
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const usage = { limits: [], modelLimits: [] };
        if (data.limits_progress) {
          for (const lp of data.limits_progress) {
            usage.limits.push({
              feature: lp.feature_name,
              remaining: lp.remaining,
              resetsAt: lp.reset_after,
            });
          }
        }
        if (data.model_limits) {
          for (const ml of data.model_limits) {
            usage.modelLimits.push({
              model: ml.model_slug || ml.model,
              remaining: ml.remaining,
              limit: ml.limit || ml.max,
              resetsAt: ml.reset_after,
            });
          }
        }
        send({ type: "insights-usage", platform: "chatgpt", usage });
      })
      .catch(() => {});
  }

  // ── Gemini real usage polling ───────────────────────────
  // Fetches qpEbW RPC which returns per-feature quota table:
  // [[category, feature_id, ?], status, ?, [reset_ts_s, reset_ts_ns], limit, remaining]
  function pollGeminiUsage() {
    const sid = window.WIZ_global_data?.FdrFJe || "";
    const at = window.WIZ_global_data?.SNlM0e || "";
    if (!sid) return;
    const body = new URLSearchParams();
    body.append("f.req", JSON.stringify([[["qpEbW", "[]", null, "generic"]]]));
    body.append("at", at);
    fetch("/_/BardChatUi/data/batchexecute?rpcids=qpEbW&bl=boq_assistant-bard-web-server_20260511.08_p0&f.sid=" + sid + "&hl=en&_reqid=" + Math.floor(Math.random() * 9999999) + "&rt=c", {
      method: "POST", credentials: "same-origin", body,
    })
      .then((r) => r.text())
      .then((raw) => {
        const lines = raw.split("\n").filter((l) => l.trim());
        let parsed = null;
        for (const line of lines) {
          try { const j = JSON.parse(line); if (Array.isArray(j)) { parsed = j; break; } } catch (e) {}
        }
        if (!parsed) return;
        const dataStr = parsed[0]?.[2];
        if (!dataStr) return;
        let quotas;
        try { quotas = JSON.parse(dataStr); } catch (e) { return; }
        if (!Array.isArray(quotas) || !Array.isArray(quotas[0])) return;

        const features = [];
        for (const q of quotas[0]) {
          if (!Array.isArray(q) || q.length < 6) continue;
          const featureId = q[0]?.[1];
          const resetTs = q[3]?.[0];
          const limit = q[4];
          const remaining = q[5];
          if (typeof limit !== "number" || typeof remaining !== "number") continue;
          features.push({ id: featureId, limit, remaining, resetsAt: resetTs ? new Date(resetTs * 1000).toISOString() : null });
        }
        // Find the main chat feature — the one with the highest limit (typically 1000 for Pro)
        features.sort((a, b) => b.limit - a.limit);
        send({
          type: "insights-usage", platform: "gemini",
          usage: { features, mainChat: features[0] || null },
        });
      })
      .catch(() => {});
  }

  // ── Boot ─────────────────────────────────────────────────
  if (PLATFORM === "claude") detectClaudeViaApi();
  if (PLATFORM === "chatgpt") detectChatgptViaApi();

  setTimeout(() => {
    detectSubscription();
    markExistingMessages();
    startMessageObserver();
    if (PLATFORM === "claude") pollClaudeUsage();
    if (PLATFORM === "chatgpt") pollChatgptUsage();
    if (PLATFORM === "gemini") pollGeminiUsage();
  }, 3000);

  setInterval(detectSubscription, 60000);
  if (PLATFORM === "claude") setInterval(pollClaudeUsage, 60000);
  if (PLATFORM === "chatgpt") setInterval(pollChatgptUsage, 60000);
  if (PLATFORM === "gemini") setInterval(pollGeminiUsage, 60000);
})();
