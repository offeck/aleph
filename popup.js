(function () {
  "use strict";

  // ── Defaults (shared with settings.js and content.js) ──
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
  };

  const THEME_NAMES = {
    none: "Default", warmDark: "Warm Dark", coolDark: "Cool Dark",
    paperLight: "Paper Light", highContrast: "High Contrast", midnight: "Midnight",
    nord: "Nord", dracula: "Dracula", solarized: "Solarized", rosePine: "Rosé Pine",
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

  // ── Insights loading ──────────────────────────────────────────────
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
        todayTokens += (d.tokensIn || 0) + (d.tokensOut || 0);
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

      // Weekly sparkline
      const weekDays = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const k = "usage_" + d.toISOString().slice(0, 10);
        weekDays.push(weekData?.[k] || null);
      }

      let weekTotalSeconds = 0;
      const dayTotals = weekDays.map((day) => {
        const totals = { claude: 0, chatgpt: 0, gemini: 0, total: 0, tokens: 0 };
        if (!day) return totals;
        for (const p of ["claude", "chatgpt", "gemini"]) {
          const s = day[p]?.totalSeconds || 0;
          const t = (day[p]?.tokensIn || 0) + (day[p]?.tokensOut || 0);
          totals[p] = s;
          totals.total += s;
          totals.tokens += t;
          weekTotalSeconds += s;
        }
        return totals;
      });

      const maxDaySeconds = Math.max(...dayTotals.map((d) => d.total), 1);
      const sparkline = document.getElementById("weekSparkline");
      sparkline.innerHTML = "";
      for (const day of dayTotals) {
        const bar = document.createElement("div");
        bar.className = "spark-bar";
        for (const p of ["gemini", "chatgpt", "claude"]) {
          if (day[p] <= 0) continue;
          const seg = document.createElement("div");
          seg.className = `spark-seg ${p}`;
          seg.style.height = `${(day[p] / maxDaySeconds) * 100}%`;
          bar.appendChild(seg);
        }
        sparkline.appendChild(bar);
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
          ? `↑${weekTrend.pct}%`
          : weekTrend.dir === "down" ? `↓${Math.abs(weekTrend.pct)}%` : "—";
      }

      // Token sparkline
      const maxDayTokens = Math.max(...dayTotals.map((d) => d.tokens), 1);
      let weekTotalTokens = 0;
      const tokenSparkline = document.getElementById("tokenSparkline");
      tokenSparkline.innerHTML = "";
      for (const day of dayTotals) {
        weekTotalTokens += day.tokens;
        const bar = document.createElement("div");
        bar.className = "spark-bar";
        if (day.tokens > 0) {
          const seg = document.createElement("div");
          seg.className = "spark-seg";
          seg.style.height = `${(day.tokens / maxDayTokens) * 100}%`;
          seg.style.background = "#7c83ff";
          bar.appendChild(seg);
        }
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
            prevWeekTokens += (day[p]?.tokensIn || 0) + (day[p]?.tokensOut || 0);
          }
        }
      }
      const tokenTrend = computeTrend(weekTotalTokens, prevWeekTokens);
      const tokenTrendEl = document.getElementById("tokenTrend");
      if (tokenTrend.dir !== "flat" || prevWeekTokens > 0) {
        tokenTrendEl.className = `trend-badge ${tokenTrend.dir}`;
        tokenTrendEl.textContent = tokenTrend.dir === "up"
          ? `↑${tokenTrend.pct}%`
          : tokenTrend.dir === "down" ? `↓${Math.abs(tokenTrend.pct)}%` : "—";
      }

      // Remark
      if (remark?.text) {
        document.getElementById("remark").textContent = remark.text;
      }
    });
  }

  // ── Theme grid ─────────────────────────────────────────────────────
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

  // ── Platform chips ─────────────────────────────────────────────────
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

  // ── Load settings into UI ──────────────────────────────────────────
  function loadUI() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      document.getElementById("focusMode").checked = s.focusMode;
      document.getElementById("fontFamily").value = s.fontFamily;

      const fsInput = document.getElementById("fontSize");
      const fsOutput = document.getElementById("fontSizeVal");
      fsInput.value = s.fontSize;
      fsOutput.textContent = s.fontSize == 0 ? "default" : `${s.fontSize}px`;

      initThemeGrid(s.theme || "none");
      initPlatformChips(s);
    });
  }

  // ── Export / Import ────────────────────────────────────────────────
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

  // ── Bind events ────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById("focusMode").addEventListener("change", (e) => {
      save("focusMode", e.target.checked);
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

  // ── Init ───────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    loadUI();
    bindEvents();
    loadInsights();
    detectActivePlatform();
  });
})();
