(function () {
  "use strict";

  // Defaults (shared with settings.js and content.js)
  const DEFAULTS = {
    bidiEnabled: true,
    enableClaude: true,
    enableChatgpt: true,
    enableGemini: true,
    fontFamily: "",
    fontSize: 0,
    lineHeight: 0,
    paragraphSpacing: 0,
    codeFontSize: 0,
    codeFontFamily: "",
    chatWidth: 0,
    theme: "none",
    themeClaude: "",
    themeChatgpt: "",
    themeGemini: "",
    focusMode: false,
    focusHideUpgrade: true,
    focusHideChips: true,
    focusHidePromos: true,
    latexFix: true,
    streamSmooth: true,
    streamAnimation: "platform",
    messageSpacing: 0,
    miniGame: false,
  };

  const THEME_NAMES = {
    none: "Default", warmDark: "Warm Dark", coolDark: "Cool Dark",
    paperLight: "Paper Light", highContrast: "High Contrast", midnight: "Midnight",
    nord: "Nord", dracula: "Dracula", solarized: "Solarized", rosePine: "Ros\u00e9 Pine",
    catppuccin: "Catppuccin", gruvbox: "Gruvbox", oneDark: "One Dark",
    tokyoNight: "Tokyo Night", githubDark: "GitHub Dark",
  };

  const PLATFORM_COLORS = {
    claude: "#D97706", chatgpt: "#4285F4", gemini: "#10A37F",
  };
  const PLATFORM_LABELS = {
    claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini",
  };

  function save(key, value) {
    chrome.storage.sync.set({ [key]: value });
  }

  // Insights loading
  function formatTime(seconds) {
    if (!seconds || seconds < 60) return seconds ? `${Math.round(seconds)}s` : "0m";
    const m = Math.round(seconds / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }

  function formatTokens(n) {
    if (!n) return "~0";
    if (n >= 1000) return `~${(n / 1000).toFixed(1)}K`;
    return `~${n}`;
  }

  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function usageKeyForDate(date = new Date()) {
    return "usage_" + localDateString(date);
  }

  function estimatedTokenTotal(day) {
    if (!day) return 0;
    return (day.tokensIn || 0) + (day.tokensOut || 0);
  }

  function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function cleanLabel(value, fallback) {
    return String(value || fallback || "Usage").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function addQuotaMeter(target, label, item, color) {
    const limit = asNumber(item?.limit);
    const remaining = asNumber(item?.remaining);
    const used = asNumber(item?.used);
    if (limit && limit > 0) {
      if (used == null && remaining == null) {
        target.push({ label, pct: null, detail: `limit ${limit}`, color, alwaysShow: true });
        return;
      }
      const actualUsed = used != null ? used : Math.max(0, limit - (remaining || 0));
      const pct = Math.min(100, Math.max(0, Math.round((actualUsed / limit) * 100)));
      const detail = remaining != null ? `${remaining}/${limit} left` : `${actualUsed}/${limit} used`;
      target.push({ label, pct, detail, color, alwaysShow: true });
      return;
    }
    if (remaining != null) {
      target.push({ label, pct: null, detail: `${remaining} left`, color, alwaysShow: true });
    }
  }

  function shortCodexModelLabel(model) {
    return String(model || "Codex")
      .replace(/^GPT[-\d.]*-/i, "")
      .replace(/^Codex-/i, "Codex ")
      .replace(/-/g, " ");
  }

  function codexLimitLabel(card) {
    const suffix = card?.period === "weekly" ? "weekly" : (card?.period || "limit");
    if (card?.model) return `${shortCodexModelLabel(card.model)} ${suffix}`;
    return `Codex ${suffix}`;
  }

  function addCodexLimitMeter(target, card, color) {
    const remainingPct = asNumber(card?.remainingPct);
    const usedPct = asNumber(card?.usedPct);
    if (remainingPct == null && usedPct == null) return;
    const pct = usedPct != null ? usedPct : Math.max(0, Math.min(100, 100 - remainingPct));
    const remaining = remainingPct != null ? remainingPct : Math.max(0, Math.min(100, 100 - pct));
    target.push({
      label: codexLimitLabel(card),
      pct: Math.round(pct),
      detail: `${Math.round(remaining)}% left`,
      color,
      alwaysShow: true,
    });
  }

  function sumCodexWorkspace(data) {
    const rows = Array.isArray(data?.data) ? data.data : [];
    const totals = { threads: 0, turns: 0, credits: 0 };
    for (const row of rows) {
      totals.threads += asNumber(row?.totals?.threads) || 0;
      totals.turns += asNumber(row?.totals?.turns) || 0;
      totals.credits += asNumber(row?.totals?.credits) || 0;
    }
    return totals.threads || totals.turns || totals.credits ? totals : null;
  }

  function computeTrend(current, previous) {
    if (!previous || previous === 0) return { pct: 0, dir: "flat" };
    const pct = Math.round(((current - previous) / previous) * 100);
    return { pct, dir: pct > 5 ? "up" : pct < -5 ? "down" : "flat" };
  }

  function loadInsights() {
    chrome.runtime.sendMessage({ type: "insights-get-summary" }, (resp) => {
      if (!resp) return;
      const { subs, today, remark, weekData, prevWeekData } = resp;

      // Spend card
      let totalSpend = 0;
      const breakdownEl = document.getElementById("spendBreakdown");
      breakdownEl.innerHTML = "";
      for (const p of ["claude", "chatgpt", "gemini"]) {
        const sub = subs?.[p];
        const price = sub?.price || 0;
        totalSpend += price;
        const item = document.createElement("span");
        item.className = `spend-item ${p}`;
        item.innerHTML = `<span class="dot"></span>${PLATFORM_LABELS[p]} ${sub?.label || "?"} $${price}`;
        breakdownEl.appendChild(item);
      }
      document.getElementById("spendAmount").textContent = `$${totalSpend.toFixed(2)}`;

      // Today card
      let todaySeconds = 0, todayMsgs = 0, todayTokens = 0;
      for (const p of ["claude", "chatgpt", "gemini"]) {
        const d = today?.[p];
        if (!d) continue;
        todaySeconds += d.totalSeconds || 0;
        todayMsgs += d.messageCount || 0;
        todayTokens += estimatedTokenTotal(d);
      }
      document.getElementById("todayTime").textContent = formatTime(todaySeconds);
      document.getElementById("todayMsgs").textContent = String(todayMsgs);
      document.getElementById("todayTokens").textContent = formatTokens(todayTokens);

      // Time bar
      const timeBar = document.getElementById("todayTimeBar");
      timeBar.innerHTML = "";
      if (todaySeconds > 0) {
        for (const p of ["claude", "chatgpt", "gemini"]) {
          const s = today?.[p]?.totalSeconds || 0;
          if (s <= 0) continue;
          const seg = document.createElement("div");
          seg.className = `time-bar-seg ${p}`;
          seg.style.width = `${(s / todaySeconds) * 100}%`;
          timeBar.appendChild(seg);
        }
      }

      // Per-platform breakdown (time + msgs per platform)
      const bdEl = document.getElementById("platformBreakdown");
      bdEl.innerHTML = "";
      for (const p of ["claude", "chatgpt", "gemini"]) {
        const d = today?.[p];
        const s = d?.totalSeconds || 0;
        const m = d?.messageCount || 0;
        if (s <= 0 && m <= 0) continue;
        const item = document.createElement("span");
        item.className = `pb-item ${p}`;
        item.innerHTML = `<span class="pb-dot"></span>${PLATFORM_LABELS[p]}: <span class="pb-value">${formatTime(s)}</span> &middot; <span class="pb-value">${m}</span> msgs`;
        bdEl.appendChild(item);
      }

      // Usage meters: provider-backed quotas first, local estimates only as fallback.
      const { platformUsage } = resp;
      const metersEl = document.getElementById("usageMeters");
      const meters = [];

      // Collect raw meter data per platform, then filter
      const rawMeters = { claude: [], chatgpt: [], gemini: [] };

      // Claude: real utilization from API
      if (platformUsage?.claude?.fiveHour || platformUsage?.claude?.sevenDay) {
        const cu = platformUsage.claude;
        if (cu.fiveHour) rawMeters.claude.push({ label: "Claude 5h", pct: Math.round(cu.fiveHour.utilization), color: "#D97706", alwaysShow: true });
        if (cu.sevenDay) rawMeters.claude.push({ label: "Claude 7d", pct: Math.round(cu.sevenDay.utilization), color: "#D97706", alwaysShow: true });
      }

      // ChatGPT/Codex: provider-backed usage.
      const gptUsage = platformUsage?.chatgpt;
      const GPT_LABELS = { deep_research: "Research", odyssey: "Reasoning", image_gen: "Images" };
      const gptChat = gptUsage?.chat || gptUsage;
      for (const ml of (gptChat?.modelLimits || []).slice(0, 4)) {
        addQuotaMeter(rawMeters.chatgpt, `ChatGPT ${cleanLabel(ml.model, "GPT")}`, ml, "#4285F4");
      }
      for (const lp of (gptChat?.limits || [])) {
        addQuotaMeter(rawMeters.chatgpt, `ChatGPT ${GPT_LABELS[lp.feature] || cleanLabel(lp.feature, "GPT")}`, lp, "#4285F4");
      }

      const codexAnalytics = gptUsage?.codex?.analytics;
      for (const card of (codexAnalytics?.limits || [])) {
        addCodexLimitMeter(rawMeters.chatgpt, card, "#4285F4");
      }
      if (codexAnalytics?.credits) {
        rawMeters.chatgpt.push({
          label: "Codex credits",
          pct: null,
          detail: `${codexAnalytics.credits.remaining || 0} left`,
          color: "#4285F4",
          alwaysShow: true,
        });
      }

      const codexTotals = sumCodexWorkspace(gptUsage?.codex?.dailyWorkspaceUsage);
      if (codexTotals) {
        rawMeters.chatgpt.push({
          label: "Codex",
          pct: null,
          detail: `${codexTotals.turns} turns / ${codexTotals.threads} threads`,
          color: "#4285F4",
          alwaysShow: true,
        });
      }

      if (rawMeters.chatgpt.length === 0 && (today?.chatgpt?.messageCount || 0) > 0) {
        rawMeters.chatgpt.push({
          label: "ChatGPT est.",
          pct: null,
          detail: `${today.chatgpt.messageCount} local msgs`,
          color: "#4285F4",
          alwaysShow: true,
        });
      }

      // Gemini: feature 4 = Pro 3.1, feature 15 = Thinking (confirmed via testing)
      const gemUsage = platformUsage?.gemini;
      if (gemUsage?.features?.length > 0) {
        const proChat = gemUsage.features.find((f) => f.id === 4);
        const thinking = gemUsage.features.find((f) => f.id === 15);
        for (const f of [proChat, thinking].filter(Boolean)) {
          addQuotaMeter(rawMeters.gemini, f.name, f, "#10A37F");
        }
      }

      // Filter: provider rows are useful even at 0% or without a percentage.
      // If all rows are old non-provider 0% rows, show a compact fallback.
      const PLATFORM_FALLBACK = { claude: { label: "Claude", color: "#D97706" }, chatgpt: { label: "ChatGPT", color: "#4285F4" }, gemini: { label: "Gemini", color: "#10A37F" } };
      for (const p of ["claude", "chatgpt", "gemini"]) {
        const pm = rawMeters[p];
        if (pm.length === 0) continue;
        const used = pm.filter((m) => m.alwaysShow || m.pct == null || m.pct > 0);
        if (used.length > 0) {
          meters.push(...used);
        } else {
          meters.push({ label: PLATFORM_FALLBACK[p].label, pct: 0, color: PLATFORM_FALLBACK[p].color, alwaysShow: true });
        }
      }

      if (meters.length > 0) {
        metersEl.innerHTML = "";
        metersEl.style.display = "";
        for (const m of meters) {
          const fillColor = m.pct != null && m.pct >= 90 ? "#ff6b6b" : m.color;
          const row = document.createElement("div");
          row.className = "usage-meter";
          if (m.pct == null) {
            row.innerHTML =
              `<span class="usage-meter-label" style="color:${fillColor}">${m.label}</span>` +
              `<span class="usage-meter-detail" style="color:${fillColor}">${m.detail || ""}</span>`;
          } else {
            row.innerHTML =
              `<span class="usage-meter-label" style="color:${fillColor}">${m.label}</span>` +
              `<div class="usage-meter-track"><div class="usage-meter-fill" style="width:${Math.max(m.pct, 2)}%;background:${fillColor}"></div></div>` +
              `<span class="usage-meter-pct" style="color:${fillColor}">${m.detail || (m.pct + "%")}</span>`;
          }
          metersEl.appendChild(row);
        }
      }

      // Weekly sparkline
      const weekDays = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const k = usageKeyForDate(d);
        weekDays.push(weekData?.[k] || null);
      }

      let weekTotalSeconds = 0;
      const dayTotals = weekDays.map((day) => {
        const totals = { claude: 0, chatgpt: 0, gemini: 0, total: 0, tokens: 0 };
        if (!day) return totals;
        for (const p of ["claude", "chatgpt", "gemini"]) {
          const s = day[p]?.totalSeconds || 0;
          const t = estimatedTokenTotal(day[p]);
          totals[p] = s;
          totals.total += s;
          totals.tokens += t;
          weekTotalSeconds += s;
        }
        return totals;
      });

      const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];
      const DAY_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const todayDow = now.getDay();

      // Build date strings for each of the 7 days
      const dayDates = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dayDates.push(d);
      }

      const maxDaySeconds = Math.max(...dayTotals.map((d) => d.total), 1);
      const sparkline = document.getElementById("weekSparkline");
      sparkline.innerHTML = "";
      const dayLabels = document.getElementById("weekDayLabels");
      dayLabels.innerHTML = "";
      for (let di = 0; di < dayTotals.length; di++) {
        const day = dayTotals[di];
        const isToday = di === 6;
        const dayOfWeek = dayDates[di].getDay();
        const dateStr = dayDates[di].toLocaleDateString([], { month: "short", day: "numeric" });

        const bar = document.createElement("div");
        bar.className = "spark-bar" + (isToday ? " today-bar" : "");

        // Tooltip content
        const parts = [`${DAY_FULL[dayOfWeek]}, ${dateStr}`];
        if (day.total > 0) {
          parts.push(`Time: ${formatTime(day.total)}`);
          for (const p of ["claude", "chatgpt", "gemini"]) {
            if (day[p] > 0) parts.push(`  ${PLATFORM_LABELS[p]}: ${formatTime(day[p])}`);
          }
        } else {
          parts.push("No activity");
        }
        bar.setAttribute("data-tooltip", parts.join("\n"));

        for (const p of ["gemini", "chatgpt", "claude"]) {
          if (day[p] <= 0) continue;
          const seg = document.createElement("div");
          seg.className = `spark-seg ${p}`;
          seg.style.height = `${(day[p] / maxDaySeconds) * 100}%`;
          bar.appendChild(seg);
        }
        sparkline.appendChild(bar);

        const lbl = document.createElement("span");
        lbl.className = "spark-day-label" + (isToday ? " today" : "");
        lbl.textContent = DAY_NAMES[dayOfWeek];
        dayLabels.appendChild(lbl);
      }
      document.getElementById("weekTotal").textContent =
        `${(weekTotalSeconds / 3600).toFixed(1)}h total`;

      // Week trend
      let prevWeekSeconds = 0;
      if (prevWeekData) {
        for (const k of Object.keys(prevWeekData)) {
          const day = prevWeekData[k];
          if (!day) continue;
          for (const p of ["claude", "chatgpt", "gemini"]) {
            prevWeekSeconds += day[p]?.totalSeconds || 0;
          }
        }
      }
      const weekTrend = computeTrend(weekTotalSeconds, prevWeekSeconds);
      const weekTrendEl = document.getElementById("weekTrend");
      if (weekTrend.dir !== "flat" || prevWeekSeconds > 0) {
        weekTrendEl.className = `trend-badge ${weekTrend.dir}`;
        weekTrendEl.textContent = weekTrend.dir === "up"
          ? `\u2191${weekTrend.pct}%`
          : weekTrend.dir === "down" ? `\u2193${Math.abs(weekTrend.pct)}%` : "\u2014";
      }

      // Token sparkline
      const maxDayTokens = Math.max(...dayTotals.map((d) => d.tokens), 1);
      let weekTotalTokens = 0;
      const tokenSparkline = document.getElementById("tokenSparkline");
      tokenSparkline.innerHTML = "";
      const tokenDayLabels = document.getElementById("tokenDayLabels");
      tokenDayLabels.innerHTML = "";
      for (let di = 0; di < dayTotals.length; di++) {
        const day = dayTotals[di];
        const isToday = di === 6;
        weekTotalTokens += day.tokens;
        const dayOfWeek = dayDates[di].getDay();
        const dateStr = dayDates[di].toLocaleDateString([], { month: "short", day: "numeric" });

        const bar = document.createElement("div");
        bar.className = "spark-bar" + (isToday ? " today-bar" : "");

        const parts = [`${DAY_FULL[dayOfWeek]}, ${dateStr}`];
        if (day.tokens > 0) parts.push(`Tokens: ${formatTokens(day.tokens)}`);
        else parts.push("No tokens");
        bar.setAttribute("data-tooltip", parts.join("\n"));

        if (day.tokens > 0) {
          const seg = document.createElement("div");
          seg.className = "spark-seg";
          seg.style.height = `${(day.tokens / maxDayTokens) * 100}%`;
          seg.style.background = "#7c83ff";
          bar.appendChild(seg);
        }

        const lbl = document.createElement("span");
        lbl.className = "spark-day-label" + (isToday ? " today" : "");
        lbl.textContent = DAY_NAMES[dayOfWeek];
        tokenDayLabels.appendChild(lbl);
        tokenSparkline.appendChild(bar);
      }
      document.getElementById("tokenTotal").textContent = formatTokens(weekTotalTokens) + " total";

      // Token trend
      let prevWeekTokens = 0;
      if (prevWeekData) {
        for (const k of Object.keys(prevWeekData)) {
          const day = prevWeekData[k];
          if (!day) continue;
          for (const p of ["claude", "chatgpt", "gemini"]) {
            prevWeekTokens += estimatedTokenTotal(day[p]);
          }
        }
      }
      const tokenTrend = computeTrend(weekTotalTokens, prevWeekTokens);
      const tokenTrendEl = document.getElementById("tokenTrend");
      if (tokenTrend.dir !== "flat" || prevWeekTokens > 0) {
        tokenTrendEl.className = `trend-badge ${tokenTrend.dir}`;
        tokenTrendEl.textContent = tokenTrend.dir === "up"
          ? `\u2191${tokenTrend.pct}%`
          : tokenTrend.dir === "down" ? `\u2193${Math.abs(tokenTrend.pct)}%` : "\u2014";
      }

      // Remark (right side of header)
      const remarkEl = document.getElementById("remark");
      if (remark?.text) {
        remarkEl.textContent = remark.text;
        remarkEl.classList.add("active");
      }
    });
  }

  // Theme grid
  let themeApplyLocal = false;
  let detectedPlatform = null;

  function initThemeGrid(currentTheme) {
    const grid = document.getElementById("themeGrid");
    grid.querySelectorAll(".theme-swatch").forEach((btn) => {
      const t = btn.getAttribute("data-theme");
      btn.classList.toggle("active", t === currentTheme);
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".theme-swatch").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        if (themeApplyLocal && detectedPlatform) {
          const key = "theme" + detectedPlatform.charAt(0).toUpperCase() + detectedPlatform.slice(1);
          save(key, t === "none" ? "" : t);
        } else {
          save("theme", t);
        }
      });
    });
  }

  function detectActivePlatform() {
    chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs?.[0]?.url) return;
      const url = tabs[0].url;
      if (url.includes("claude.ai")) detectedPlatform = "claude";
      else if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) detectedPlatform = "chatgpt";
      else if (url.includes("gemini.google.com")) detectedPlatform = "gemini";
      else return;

      const row = document.getElementById("themePlatformRow");
      const nameEl = document.getElementById("currentPlatformName");
      if (row && nameEl) {
        nameEl.textContent = PLATFORM_LABELS[detectedPlatform];
        row.style.display = "";
      }
    });
  }

  // Platform chips
  function initPlatformChips(settings) {
    document.querySelectorAll("#platformChips .chip").forEach((chip) => {
      const key = chip.getAttribute("data-key");
      chip.classList.toggle("active", settings[key]);
      chip.addEventListener("click", () => {
        const newVal = !chip.classList.contains("active");
        chip.classList.toggle("active", newVal);
        save(key, newVal);
      });
    });
  }

  // Load settings into UI
  function loadUI() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      document.getElementById("focusMode").checked = s.focusMode;
      document.getElementById("miniGame").checked = s.miniGame;
      document.getElementById("fontFamily").value = s.fontFamily;

      const fsInput = document.getElementById("fontSize");
      const fsOutput = document.getElementById("fontSizeVal");
      fsInput.value = s.fontSize;
      fsOutput.textContent = s.fontSize == 0 ? "default" : `${s.fontSize}px`;

      initThemeGrid(s.theme || "none");
      initPlatformChips(s);
    });
  }

  // Export / Import
  function exportSettings() {
    chrome.storage.sync.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "aleph-settings.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const filtered = {};
        for (const key of Object.keys(DEFAULTS)) {
          if (key in data) filtered[key] = data[key];
        }
        chrome.storage.sync.set(filtered, () => loadUI());
      } catch (err) {
        console.error("[Aleph] Import failed:", err);
      }
    };
    reader.readAsText(file);
  }

  // Bind events
  function bindEvents() {
    document.getElementById("focusMode").addEventListener("change", (e) => {
      save("focusMode", e.target.checked);
    });

    document.getElementById("miniGame").addEventListener("change", (e) => {
      save("miniGame", e.target.checked);
    });

    document.getElementById("fontFamily").addEventListener("change", (e) => {
      save("fontFamily", e.target.value);
    });

    const fsInput = document.getElementById("fontSize");
    const fsOutput = document.getElementById("fontSizeVal");
    fsInput.addEventListener("input", () => {
      fsOutput.textContent = fsInput.value == 0 ? "default" : `${fsInput.value}px`;
    });
    fsInput.addEventListener("change", () => {
      save("fontSize", parseFloat(fsInput.value));
    });

    document.getElementById("themeApplyLocal")?.addEventListener("change", (e) => {
      themeApplyLocal = e.target.checked;
    });

    const openSettings = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
    };
    document.getElementById("settingsBtn").addEventListener("click", openSettings);
    document.getElementById("settingsBtn2").addEventListener("click", openSettings);

    document.getElementById("dashboardBtn").addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("insights.html") });
    });

    document.getElementById("exportBtn").addEventListener("click", exportSettings);
    document.getElementById("importBtn").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document.getElementById("importFile").addEventListener("change", (e) => {
      if (e.target.files[0]) {
        importSettings(e.target.files[0]);
        e.target.value = "";
      }
    });
  }

  function loadSyncIndicator() {
    chrome.runtime.sendMessage({ type: "aleph-sync-status" }, (state) => {
      var el = document.getElementById("syncIndicator");
      if (el && state?.signedIn) el.style.display = "";
    });
  }

  // Init
  document.addEventListener("DOMContentLoaded", () => {
    loadUI();
    bindEvents();
    loadInsights();
    detectActivePlatform();
    loadSyncIndicator();
  });
})();
