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
    gemini:  ["model-response", ".conversation-turn", ".query-content"],
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
  let graceUntil = 0;
  let userSentAt = 0;

  const EDITOR_SEL = "[contenteditable], textarea, #prompt-textarea, .ProseMirror, .ql-editor, rich-textarea";
  const HEB_RE = /[֐-׿]/g;
  let lastEditorText = "";

  function captureAndSignal(source) {
    let text = "";
    for (const sel of [".ProseMirror", "#prompt-textarea", ".ql-editor"]) {
      const ed = document.querySelector(sel);
      if (ed) { text = (ed.textContent || "").trim(); break; }
    }
    if (!text && lastEditorText) text = lastEditorText;
    if (!text) {
      userSentAt = Date.now();
      return;
    }

    const stripped = text.replace(/\s/g, "");
    HEB_RE.lastIndex = 0;
    const hebCount = (stripped.match(HEB_RE) || []).length;
    const lang = stripped.length > 0 && hebCount / stripped.length > 0.3 ? "hebrew" : "other";
    const words = text.split(/\s+/).filter(Boolean).length;

    userSentAt = Date.now();
    responseTimingActive = true;
    thinkingStartedAt = 0;
    msgCountAtSend = document.querySelectorAll(ASSISTANT_SEL).length;

    document.documentElement.setAttribute("data-aleph-send-hint", JSON.stringify({
      ts: userSentAt, lang, len: text.length, words,
    }));

    send({
      type: "insights-send-analytics",
      platform: PLATFORM, lang, length: text.length, words, timestamp: userSentAt,
    });

    console.log("[Aleph] send detected (" + source + ") lang=" + lang + " len=" + text.length);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.target.closest?.(EDITOR_SEL)) {
        captureAndSignal("Enter");
      }
    }
  }, true);
  window.addEventListener("click", (e) => {
    const btn = e.target.closest?.("button");
    if (!btn) return;
    const form = btn.closest("form, fieldset, [class*='composer'], [class*='input-container'], [class*='chat-input']");
    if (form && form.querySelector(EDITOR_SEL)) {
      captureAndSignal("button");
    }
  }, true);

  // Fallback: detect editor emptying (message was sent)
  let lastEditorLen = 0;
  setInterval(() => {
    for (const sel of [".ProseMirror", "#prompt-textarea", ".ql-editor"]) {
      const ed = document.querySelector(sel);
      if (!ed) continue;
      const text = (ed.textContent || "").trim();
      const len = text.length;
      if (lastEditorLen > 0 && len === 0) {
        captureAndSignal("editor empty");
      }
      lastEditorLen = len;
      if (len > 0) lastEditorText = text;
      break;
    }
  }, 500);

  // ── Response timing (TTFT + thinking duration) ──────────
  const THINKING_SEL = {
    claude: '[aria-label="Stop response"]',
    chatgpt: '[aria-label="Stop streaming"], [aria-label*="Stop" i]',
    gemini: '.send-button.stop',
  };

  let responseTimingActive = false;
  let thinkingStartedAt = 0;
  let msgCountAtSend = 0;

  const ASSISTANT_SEL = '[data-message-author-role="assistant"], .font-claude-response, .response-content';

  function detectFirstToken() {
    const msgs = document.querySelectorAll(ASSISTANT_SEL);
    if (msgs.length <= msgCountAtSend) return false;
    const last = msgs[msgs.length - 1];
    if (!last) return false;

    if (PLATFORM === "chatgpt") {
      const markdowns = last.querySelectorAll('.markdown');
      const lastMd = markdowns.length ? markdowns[markdowns.length - 1] : null;
      const p = lastMd ? lastMd.querySelector('p') : null;
      return p ? p.textContent.trim().length > 20 : false;
    }

    const p = last.querySelector('p');
    const threshold = PLATFORM === "gemini" ? 10 : 5;
    return p ? p.textContent.trim().length > threshold : false;
  }

  setInterval(() => {
    if (!userSentAt || !responseTimingActive) return;
    const elapsed = Date.now() - userSentAt;
    const sel = THINKING_SEL[PLATFORM];

    if (!thinkingStartedAt) {
      if (sel && document.querySelector(sel)) {
        thinkingStartedAt = Date.now();
        document.documentElement.setAttribute("data-aleph-thinking", "true");
        console.log("[Aleph] thinking started (stop button appeared)");
      }
    }

    if (thinkingStartedAt) {
      if (detectFirstToken()) {
        send({
          type: "insights-response-timing",
          platform: PLATFORM,
          sendToThinking: thinkingStartedAt - userSentAt,
          thinkingToFirstToken: Date.now() - thinkingStartedAt,
          totalTTFT: Date.now() - userSentAt,
          timestamp: Date.now(),
        });
        console.log("[Aleph] TTFT: " + (Date.now() - userSentAt) + "ms (thinking: " + (Date.now() - thinkingStartedAt) + "ms)");
        responseTimingActive = false;
        thinkingStartedAt = 0;
        document.documentElement.removeAttribute("data-aleph-thinking");
      }
    }

    if (elapsed > 120000) {
      console.log("[Aleph] response timing timed out after 120s");
      responseTimingActive = false;
      thinkingStartedAt = 0;
      document.documentElement.removeAttribute("data-aleph-thinking");
    }
  }, 500);

  function classifyMessage(el) {
    for (const s of ASSISTANT_MARKER[PLATFORM]) {
      if (el.matches?.(s) || el.querySelector?.(s)) return "assistant";
    }
    for (const s of USER_MARKER[PLATFORM]) {
      if (el.matches?.(s) || el.querySelector?.(s)) return "user";
    }
    return null;
  }

  function getCurrentModel() {
    if (PLATFORM === "chatgpt") {
      try {
        const c = document.cookie.split(";").reduce((a, c) => { const [k,...v] = c.trim().split("="); a[k]=v.join("="); return a; }, {});
        if (c["oai-last-model-config"]) return JSON.parse(decodeURIComponent(c["oai-last-model-config"])).model || "auto";
      } catch (e) {}
    }
    return null;
  }

  // Images cost tokens too — roughly 1600 tokens per image on Claude/ChatGPT,
  // varies on Gemini. Count <img> tags inside messages and add to estimate.
  const IMG_TOKEN_COST = { claude: 1600, chatgpt: 1600, gemini: 1200 };

  function processNewMessage(el) {
    if (countedMessages.has(el)) return;
    countedMessages.add(el);
    const role = classifyMessage(el);
    if (!role) return;
    const text = el.textContent || "";
    const imgCount = el.querySelectorAll("img").length;
    const textTokens = estimateTokens(text);
    const imgTokens = imgCount * (IMG_TOKEN_COST[PLATFORM] || 1600);
    console.log("[Aleph] message counted:", role, "tokens:", textTokens + imgTokens, "preview:", text.substring(0, 60));
    send({
      type: "insights-message",
      platform: PLATFORM,
      role,
      estimatedTokens: textTokens + imgTokens,
      model: getCurrentModel(),
      timestamp: Date.now(),
    });
  }

  function markExistingMessages() {
    let count = 0;
    for (const sel of MSG_WRAPPER[PLATFORM]) {
      document.querySelectorAll(sel).forEach((el) => { countedMessages.add(el); count++; });
    }
    if (count > 0) console.log("[Aleph] marked", count, "existing msgs");
  }

  // Observe document.body (not a container that SPAs might replace)
  function startMessageObserver() {
    new MutationObserver((mutations) => {
      const newMsgs = [];
      for (const m of mutations) {
        if (m.target.id === "aleph-dynamic-styles") continue;
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const sel of MSG_WRAPPER[PLATFORM]) {
            if (node.matches?.(sel)) { newMsgs.push(node); continue; }
            node.querySelectorAll?.(sel).forEach((el) => newMsgs.push(el));
          }
        }
      }
      if (newMsgs.length === 0) return;
      const inGrace = Date.now() < graceUntil;
      const recentSend = (Date.now() - userSentAt) < 30000;
      if (!recentSend && (newMsgs.length > 2 || inGrace)) {
        console.log("[Aleph] skipped", newMsgs.length, "msgs (bulk=" + (newMsgs.length > 2) + " grace=" + inGrace + ")");
        newMsgs.forEach((el) => countedMessages.add(el));
      } else {
        newMsgs.forEach(processNewMessage);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Re-mark existing messages on SPA navigation (URL change within same tab)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if ((Date.now() - userSentAt) < 15000) {
        console.log("[Aleph] nav after send — skip marking");
      } else {
        graceUntil = Date.now() + 2000;
        markExistingMessages();
        setTimeout(markExistingMessages, 500);
        setTimeout(markExistingMessages, 1000);
        setTimeout(markExistingMessages, 2000);
        setTimeout(markExistingMessages, 3000);
      }
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

  // ChatGPT: detect plan via /api/auth/session which returns the real plan_type
  // with just cookies (no bearer token needed for this endpoint).
  // Also retrieves the access token needed for usage polling.
  let chatgptApiPlan = null;

  function detectChatgptViaApi() {
    if (chatgptApiPlan) return;
    refreshChatgptToken().then((token) => {
      if (!token) {
        // Fallback: infer from model cookie
        try {
          const c = document.cookie.split(";").reduce((a, c) => { const [k,...v] = c.trim().split("="); a[k]=v.join("="); return a; }, {});
          if (c["oai-last-model-config"]) {
            const m = JSON.parse(decodeURIComponent(c["oai-last-model-config"])).model || "";
            if (/^o3$/.test(m)) chatgptApiPlan = "pro";
            else if (/^gpt-5-[2-9]|^gpt-5-5/.test(m)) chatgptApiPlan = "plus";
          }
        } catch (e) {}
      }
    });
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

    if (chatgptApiPlan) return { plan: chatgptApiPlan, model };

    // Cookie-based fallback: infer tier from the selected model
    if (model) {
      if (/^o3$/.test(model)) return { plan: "pro", model };
      if (/^gpt-5-5|^gpt-5-[2-9]/.test(model)) return { plan: "plus", model };
      if (/^gpt-5$|^gpt-5-1$/.test(model)) return { plan: "plus", model };
    }

    return { plan: "free", model };
  }

  function detectGemini() {
    let plan = "free";
    let model = null;

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

  // ── Model capabilities enrichment ──────────────────────
  // Fetches available models + capabilities from each platform's API.
  let capabilitiesFetched = false;
  function pollModelCapabilities() {
    if (capabilitiesFetched) return;
    capabilitiesFetched = true;
    try {
      if (PLATFORM === "claude") {
        const cookies = document.cookie.split(";").reduce((a, c) => {
          const [k, ...v] = c.trim().split("="); a[k] = v.join("="); return a;
        }, {});
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
      }
      if (PLATFORM === "chatgpt") {
        fetch("/backend-api/models?iim=false&is_gizmo=false", { credentials: "same-origin" })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (!data?.models) return;
            const models = data.models.map((m) => ({
              slug: m.slug, title: m.title, maxTokens: m.max_tokens,
              tools: m.enabled_tools,
            }));
            send({ type: "insights-model-caps", platform: "chatgpt", caps: { availableModels: models } });
          }).catch(() => {});
      }
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
  // Two-step auth: /api/auth/session returns a bearer token (works with cookies),
  // then /backend-api/conversation/init with that token returns real limits.
  // Without the token, the API returns guest data even for Plus users.
  let chatgptAccessToken = null;
  function refreshChatgptToken() {
    return fetch("/api/auth/session", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((session) => {
        if (session?.accessToken) chatgptAccessToken = session.accessToken;
        if (session?.account?.planType && !chatgptApiPlan) {
          chatgptApiPlan = session.account.planType === "plus" ? "plus"
            : session.account.planType === "pro" ? "pro" : chatgptApiPlan;
        }
        return chatgptAccessToken;
      })
      .catch(() => null);
  }

  function pollChatgptUsage() {
    const doFetch = (token) => {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = "Bearer " + token;
      fetch("/backend-api/conversation/init", {
        method: "POST", credentials: "same-origin", headers, body: "{}",
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
    };

    if (chatgptAccessToken) {
      doFetch(chatgptAccessToken);
    } else {
      refreshChatgptToken().then((token) => { if (token) doFetch(token); });
    }
  }

  // ── Gemini real usage polling ───────────────────────────
  // Fetches qpEbW RPC which returns per-feature quota table.
  // WIZ_global_data lives in page context (MAIN world), but content scripts
  // run in ISOLATED world — so we extract the values from <script> tags in the DOM.
  function getGeminiSessionData() {
    const scripts = document.querySelectorAll("script");
    let sid = "", at = "";
    for (const s of scripts) {
      const text = s.textContent || "";
      if (!text.includes("WIZ_global_data")) continue;
      const sidMatch = text.match(/FdrFJe["']?\s*[:=]\s*["']([^"']+)["']/);
      const atMatch = text.match(/SNlM0e["']?\s*[:=]\s*["']([^"']+)["']/);
      if (sidMatch) sid = sidMatch[1];
      if (atMatch) at = atMatch[1];
      break;
    }
    return { sid, at };
  }

  function pollGeminiUsage() {
    const { sid, at } = getGeminiSessionData();
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

        // Gemini feature IDs mapped via empirical testing:
        // - Feature 4 CONFIRMED: decrements by 1 per "Pro" mode message (limit 25 for AI Pro)
        // - Flash mode: no quota consumed (unlimited for Pro users)
        // - Feature 15: likely "Deep/Thinking" mode (limit 80)
        // Other features mapped by limit magnitude vs Google's published quotas.
        const GEMINI_FEATURE_NAMES = {
          4: "Pro 3.1", 15: "Thinking", 25: "Chat", 7: "Flash",
          13: "Extended", 16: "Agent", 9: "Images", 21: "Image Edit",
          17: "Music 30s", 24: "Screen", 26: "Audio", 14: "Slides",
          19: "Music Full", 8: "Notebook", 11: "Live",
          3: "Video Pro", 18: "Video", 5: "Video Lite", 12: "Ultra Only",
        };

        const features = [];
        for (const q of quotas[0]) {
          if (!Array.isArray(q) || q.length < 6) continue;
          const featureId = q[0]?.[1];
          const resetTs = q[3]?.[0];
          const limit = q[4];
          const remaining = q[5];
          if (typeof limit !== "number" || typeof remaining !== "number") continue;
          if (limit === 0) continue;
          features.push({
            id: featureId,
            name: GEMINI_FEATURE_NAMES[featureId] || "Feature " + featureId,
            limit, remaining,
            resetsAt: resetTs ? new Date(resetTs * 1000).toISOString() : null,
          });
        }
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
    graceUntil = Date.now() + 5000;
    startMessageObserver();
    setTimeout(markExistingMessages, 5000);
    pollModelCapabilities();
    if (PLATFORM === "claude") pollClaudeUsage();
    if (PLATFORM === "chatgpt") pollChatgptUsage();
    if (PLATFORM === "gemini") pollGeminiUsage();
  }, 3000);

  setInterval(detectSubscription, 60000);
  if (PLATFORM === "claude") setInterval(pollClaudeUsage, 60000);
  if (PLATFORM === "chatgpt") setInterval(pollChatgptUsage, 60000);
  if (PLATFORM === "gemini") setInterval(pollGeminiUsage, 60000);
})();
