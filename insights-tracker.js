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
    chatgpt: { free: { price: 0, label: "Free" }, plus: { price: 20, label: "Plus" }, pro5x: { price: 100, label: "Pro 5x" }, pro20x: { price: 200, label: "Pro 20x" } },
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

  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function dateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return localDateString(d);
  }

  function fetchJson(url, options = {}) {
    return fetch(url, options)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .catch((e) => ({ __alephError: e?.message || String(e) }));
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
  const messageEstimates = new WeakMap();

  function isContentImage(img) {
    if (img.closest?.('[data-testid*="avatar" i], [class*="avatar" i], [aria-label*="avatar" i]')) return false;
    const w = img.naturalWidth || parseInt(img.getAttribute("width"), 10) || 0;
    const h = img.naturalHeight || parseInt(img.getAttribute("height"), 10) || 0;
    return !w || !h || (w * h) >= 4096;
  }

  function estimateMessage(el) {
    const text = el.textContent || "";
    const images = Array.from(el.querySelectorAll("img")).filter(isContentImage);
    const fileCount = el.querySelectorAll(
      '[data-testid*="file" i], [aria-label*="file" i], a[href*="/backend-api/files/"], a[href*="attachment"], [class*="attachment" i]'
    ).length;
    const textTokens = estimateTokens(text);
    const imageTokens = images.length * (IMG_TOKEN_COST[PLATFORM] || 1600);
    const fileTokens = 0;
    return {
      text,
      textTokens,
      imageTokens,
      fileTokens,
      imageCount: images.length,
      fileCount,
      totalTokens: textTokens + imageTokens + fileTokens,
    };
  }

  function sendMessageEstimate(el, role, isUpdate) {
    const next = estimateMessage(el);
    const prev = messageEstimates.get(el) || {
      totalTokens: 0, textTokens: 0, imageTokens: 0, fileTokens: 0, imageCount: 0, fileCount: 0,
    };
    const delta = {
      total: next.totalTokens - prev.totalTokens,
      text: next.textTokens - prev.textTokens,
      image: next.imageTokens - prev.imageTokens,
      file: next.fileTokens - prev.fileTokens,
      imageCount: next.imageCount - prev.imageCount,
      fileCount: next.fileCount - prev.fileCount,
    };
    messageEstimates.set(el, next);

    if (isUpdate && delta.total === 0 && delta.text === 0 && delta.image === 0 && delta.file === 0 && delta.imageCount === 0 && delta.fileCount === 0) {
      return;
    }

    const payload = {
      type: "insights-message",
      platform: PLATFORM,
      role,
      estimatedTokens: next.totalTokens,
      estimatedTextTokens: next.textTokens,
      estimatedImageTokens: next.imageTokens,
      estimatedFileTokens: next.fileTokens,
      imageCount: next.imageCount,
      fileCount: next.fileCount,
      estimateSource: "local",
      model: getCurrentModel(),
      timestamp: Date.now(),
    };

    if (isUpdate) {
      payload.isUpdate = true;
      payload.tokenDelta = delta.total;
      payload.textTokenDelta = delta.text;
      payload.imageTokenDelta = delta.image;
      payload.fileTokenDelta = delta.file;
      payload.imageCountDelta = delta.imageCount;
      payload.fileCountDelta = delta.fileCount;
    }

    console.log("[Aleph] message " + (isUpdate ? "updated" : "counted") + ":", role, "tokens:", next.totalTokens, "preview:", next.text.substring(0, 60));
    send(payload);
  }

  function scheduleSettledRecount(el, role) {
    if (role !== "assistant") return;
    let lastText = el.textContent || "";
    let stableChecks = 0;
    let checks = 0;
    const check = () => {
      if (!document.contains(el)) return;
      sendMessageEstimate(el, role, true);
      const currentText = el.textContent || "";
      if (currentText === lastText) stableChecks++;
      else {
        stableChecks = 0;
        lastText = currentText;
      }
      checks++;
      if (stableChecks < 3 && checks < 20) setTimeout(check, 1500);
    };
    setTimeout(check, 1500);
  }

  function processNewMessage(el) {
    if (countedMessages.has(el)) return;
    countedMessages.add(el);
    const role = classifyMessage(el);
    if (!role) return;
    sendMessageEstimate(el, role, false);
    scheduleSettledRecount(el, role);
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

  function collectChatgptPlanSignals(value, depth = 0) {
    if (!value || depth > 3) return [];
    if (typeof value !== "object") return [String(value)];
    const signals = [];
    for (const [key, child] of Object.entries(value)) {
      if (!/plan|tier|billing|subscription|price|amount|product|sku|seat|license|account|workspace/i.test(key)) continue;
      if (child && typeof child === "object") {
        signals.push(...collectChatgptPlanSignals(child, depth + 1));
      } else if (child != null) {
        signals.push(key + ":" + String(child));
      }
    }
    return signals;
  }

  function normalizeChatgptPlan(raw, context = {}) {
    const text = [raw, context.text, ...(context.signals || [])].filter(Boolean).join(" ").toLowerCase();
    const price = Number(context.price);
    if (Number.isFinite(price)) {
      if (price >= 190) return "pro20x";
      if (price >= 90) return "pro5x";
    }
    if (/\$[\s\u00a0]*200\b|\b200\s*usd\b|\b20x\b|\bpro[_ -]?20x?\b|\b(?:price|amount|cost|monthly|billing|subscription)[a-z0-9_:= -]{0,80}200\b/.test(text)) return "pro20x";
    if (/\$[\s\u00a0]*100\b|\b100\s*usd\b|\b5x\b|\bpro[_ -]?5x?\b|\b(?:price|amount|cost|monthly|billing|subscription)[a-z0-9_:= -]{0,80}100\b/.test(text)) return "pro5x";
    if (/\bplus\b/.test(text)) return "plus";
    if (/\bpro\b/.test(text)) return "pro5x";
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

  function detectChatgptViaApi() {
    if (chatgptApiPlan) return;
    refreshChatgptToken().then((token) => {
      if (!token) {
        // Fallback: infer from model cookie
        try {
          const c = document.cookie.split(";").reduce((a, c) => { const [k,...v] = c.trim().split("="); a[k]=v.join("="); return a; }, {});
          if (c["oai-last-model-config"]) {
            const m = JSON.parse(decodeURIComponent(c["oai-last-model-config"])).model || "";
            if (/^o3$/.test(m)) chatgptApiPlan = "pro5x";
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
              source: "provider",
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
        if (session?.account && !chatgptApiPlan) {
          const plan = normalizeChatgptPlan(session.account.planType, {
            signals: collectChatgptPlanSignals(session.account),
          });
          if (plan) chatgptApiPlan = plan;
        }
        return chatgptAccessToken;
      })
      .catch(() => null);
  }

  function normalizeChatgptLimit(lp) {
    return {
      feature: lp.feature_name || lp.feature || lp.name,
      remaining: lp.remaining,
      limit: lp.limit ?? lp.max ?? lp.total,
      used: lp.used ?? lp.consumed,
      resetsAt: lp.reset_after ?? lp.resets_at,
    };
  }

  function normalizeChatgptModelLimit(ml) {
    return {
      model: ml.model_slug || ml.model || ml.slug,
      remaining: ml.remaining,
      limit: ml.limit ?? ml.max ?? ml.total,
      used: ml.used ?? ml.consumed,
      resetsAt: ml.reset_after ?? ml.resets_at,
    };
  }

  function fetchChatgptChatUsage(token) {
    if (!token) return Promise.resolve({ limits: [], modelLimits: [], error: "missing access token" });
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
    return fetchJson("/backend-api/conversation/init", {
      method: "POST", credentials: "same-origin", headers, body: "{}",
    }).then((data) => {
      if (data?.__alephError) return { limits: [], modelLimits: [], error: data.__alephError };
      const limits = Array.isArray(data?.limits_progress) ? data.limits_progress.map(normalizeChatgptLimit) : [];
      const modelLimits = Array.isArray(data?.model_limits) ? data.model_limits.map(normalizeChatgptModelLimit) : [];
      return { limits, modelLimits };
    });
  }

  let cachedCodexUsage = null;
  let lastCodexUsagePoll = 0;
  const CODEX_USAGE_POLL_MS = 5 * 60 * 1000;

  function fetchCodexUsage() {
    const now = Date.now();
    if (cachedCodexUsage && (now - lastCodexUsagePoll) < CODEX_USAGE_POLL_MS) {
      return Promise.resolve(cachedCodexUsage);
    }

    const start = dateDaysAgo(29);
    const end = localDateString();
    const opts = { credentials: "same-origin" };
    const endpoints = {
      balance: "/backend-api/wham/usage",
      dailyTokenUsage: "/backend-api/wham/usage/daily-token-usage-breakdown?start_date=" + start + "&end_date=" + end + "&group_by=day",
      dailyWorkspaceUsage: "/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=" + start + "&end_date=" + end + "&group_by=day&workspace_user=true",
      creditUsageEvents: "/backend-api/wham/usage/credit-usage-events",
    };

    return Promise.all(Object.entries(endpoints).map(([key, url]) => (
      fetchJson(url, opts).then((data) => [key, data])
    ))).then((entries) => {
      const codex = { errors: {} };
      for (const [key, data] of entries) {
        if (data?.__alephError) codex.errors[key] = data.__alephError;
        else codex[key] = data;
      }
      if (Object.keys(codex.errors).length === 0) delete codex.errors;
      if (Object.keys(codex).some((key) => key !== "errors")) {
        cachedCodexUsage = codex;
        lastCodexUsagePoll = now;
      }
      return codex;
    });
  }

  function findFirstValue(obj, names) {
    if (!obj || typeof obj !== "object") return null;
    for (const name of names) {
      if (obj[name] != null) return obj[name];
    }
    return null;
  }

  function boundedPct(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  }

  function textFromValues(obj) {
    if (!obj || typeof obj !== "object") return "";
    const keys = ["title", "label", "name", "displayName", "display_name", "model", "modelSlug", "model_slug", "bucket", "period", "window", "limitType", "limit_type"];
    return keys.map((k) => obj[k]).filter((v) => typeof v === "string").join(" ");
  }

  function normalizeCodexLimit(obj, context) {
    const text = (textFromValues(obj) + " " + (context?.text || "")).trim();
    if (!/(codex|agentic|usage|limit|quota|weekly|week|hour|5h|spark)/i.test(text + " " + Object.keys(obj).join(" "))) return null;

    const remainingPct = boundedPct(findFirstValue(obj, [
      "remainingPct", "remaining_pct", "remainingPercent", "remaining_percent", "percentRemaining", "percent_remaining", "remainingPercentage", "remaining_percentage",
    ]));
    const usedPct = boundedPct(findFirstValue(obj, [
      "usedPct", "used_pct", "usagePct", "usage_pct", "usedPercent", "used_percent", "usagePercent", "usage_percent", "utilization", "utilizationPct", "utilization_pct",
    ]));
    const remainingRaw = findFirstValue(obj, ["remaining", "remainingCredits", "remaining_credits"]);
    const limitRaw = findFirstValue(obj, ["limit", "max", "total", "quota"]);
    const remaining = remainingRaw != null ? Number(remainingRaw) : NaN;
    const limit = limitRaw != null ? Number(limitRaw) : NaN;
    const computedRemainingPct = Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0 ? boundedPct((remaining / limit) * 100) : null;
    const normalizedRemainingPct = remainingPct ?? (usedPct != null ? boundedPct(100 - usedPct) : computedRemainingPct);
    const normalizedUsedPct = usedPct ?? (normalizedRemainingPct != null ? boundedPct(100 - normalizedRemainingPct) : null);
    if (normalizedRemainingPct == null && normalizedUsedPct == null) return null;

    const periodText = text + " " + Object.entries(obj).map(([k, v]) => (typeof v === "string" ? k + " " + v : k)).join(" ");
    const period = /5\s*(?:hour|hr|h)|five[_ -]?hour|5h/i.test(periodText) ? "5h" : (/weekly|week|7d|seven[_ -]?day/i.test(periodText) ? "weekly" : "");
    if (!period) return null;

    const model = findFirstValue(obj, ["model", "modelSlug", "model_slug", "modelName", "model_name", "displayModel", "display_model"]) || context?.model || "";
    return {
      type: "limit",
      title: findFirstValue(obj, ["title", "label", "name", "displayName", "display_name"]) || "",
      period,
      model: String(model || ""),
      remainingPct: normalizedRemainingPct,
      usedPct: normalizedUsedPct,
      remaining: Number.isFinite(remaining) ? remaining : null,
      limit: Number.isFinite(limit) ? limit : null,
      resetsAt: findFirstValue(obj, ["resetsAt", "resets_at", "resetAt", "reset_at", "resetAfter", "reset_after", "nextResetAt", "next_reset_at"]) || "",
    };
  }

  function collectCodexLimits(value, out, seen, depth, context = {}) {
    if (!value || typeof value !== "object" || depth > 8 || out.length >= 12) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectCodexLimits(item, out, seen, depth + 1, context);
      return;
    }

    const normalized = normalizeCodexLimit(value, context);
    if (normalized) {
      const key = (normalized.model || "shared") + ":" + normalized.period;
      if (!out.some((item) => ((item.model || "shared") + ":" + item.period) === key)) out.push(normalized);
    }
    const contextModel = findFirstValue(value, ["model", "modelSlug", "model_slug", "modelName", "model_name", "displayModel", "display_model"]) || context.model || "";
    for (const [key, child] of Object.entries(value)) {
      const childText = (context.text || "") + " " + key + " " + (child && typeof child === "object" ? textFromValues(child) : "");
      collectCodexLimits(child, out, seen, depth + 1, { model: contextModel, text: childText });
    }
  }

  function normalizeCodexBalance(balance) {
    if (!balance || typeof balance !== "object") return null;
    const limits = [];
    collectCodexLimits(balance, limits, new WeakSet(), 0);
    const credits = findFirstValue(balance, ["creditsRemaining", "credits_remaining", "creditBalance", "credit_balance", "balance"]);
    const snapshot = {
      source: "provider",
      collectedAt: Date.now(),
      limits,
      credits: credits != null && Number.isFinite(Number(credits)) ? { remaining: Number(credits) } : null,
    };
    return limits.length > 0 || snapshot.credits ? snapshot : null;
  }

  function pollChatgptUsage() {
    const doFetch = (token) => {
      const chatPromise = token ? fetchChatgptChatUsage(token) : Promise.resolve(null);
      Promise.all([chatPromise, fetchCodexUsage()])
        .then(([chat, codex]) => {
          const hasCodexData = codex && Object.keys(codex).some((key) => key !== "errors");
          if (!chat && !hasCodexData) return;
          const codexWithAnalytics = Object.assign({}, codex);
          const analytics = normalizeCodexBalance(codex.balance);
          if (analytics) codexWithAnalytics.analytics = analytics;
          const usage = {
            source: "provider",
            codex: codexWithAnalytics,
          };
          if (chat && !chat.error) {
            usage.chat = chat;
            usage.limits = chat.limits || [];
            usage.modelLimits = chat.modelLimits || [];
          }
          send({
            type: "insights-usage",
            platform: "chatgpt",
            usage,
          });
        })
        .catch(() => {});
    };

    if (chatgptAccessToken) {
      doFetch(chatgptAccessToken);
    } else {
      refreshChatgptToken().then((token) => { doFetch(token); });
    }
  }

  // ── Gemini real usage polling ───────────────────────────
  // Fetches qpEbW RPC which returns per-feature quota table.
  // WIZ_global_data lives in page context (MAIN world), but content scripts
  // run in ISOLATED world — so we extract the values from <script> tags in the DOM.
  function getGeminiSessionData() {
    const scripts = document.querySelectorAll("script");
    let sid = "", at = "", bl = "";
    bl = getGeminiBuildLabel();
    for (const s of scripts) {
      const text = s.textContent || "";
      if (!text.includes("WIZ_global_data")) continue;
      const sidMatch = text.match(/FdrFJe["']?\s*[:=]\s*["']([^"']+)["']/);
      const atMatch = text.match(/SNlM0e["']?\s*[:=]\s*["']([^"']+)["']/);
      const blMatch = text.match(/boq_assistant-bard-web-server_[^"'\\\s&]+/);
      if (sidMatch) sid = sidMatch[1];
      if (atMatch) at = atMatch[1];
      if (!bl && blMatch) bl = blMatch[0];
      break;
    }
    return { sid, at, bl };
  }

  function getGeminiBuildLabel() {
    const re = /boq_assistant-bard-web-server_[^"'\\\s&]+/;
    try {
      const entries = performance.getEntriesByType("resource") || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const name = entries[i].name || "";
        const m = name.match(re);
        if (m) return decodeURIComponent(m[0]);
      }
    } catch (e) {}
    for (const s of document.querySelectorAll("script[src]")) {
      const m = (s.src || "").match(re);
      if (m) return decodeURIComponent(m[0]);
    }
    return "";
  }

  function pollGeminiUsage() {
    const { sid, at, bl } = getGeminiSessionData();
    if (!sid) return;
    const body = new URLSearchParams();
    body.append("f.req", JSON.stringify([[["qpEbW", "[]", null, "generic"]]]));
    body.append("at", at);
    let url = "/_/BardChatUi/data/batchexecute?rpcids=qpEbW&source-path=" + encodeURIComponent(location.pathname || "/app");
    if (bl) url += "&bl=" + encodeURIComponent(bl);
    url += "&f.sid=" + encodeURIComponent(sid) + "&hl=" + encodeURIComponent(document.documentElement.lang || "en") + "&_reqid=" + Math.floor(Math.random() * 9999999) + "&rt=c";
    fetch(url, {
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
          usage: { source: "provider", features, mainChat: features[0] || null, buildLabel: bl || null },
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
