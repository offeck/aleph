import { usageKeyForDate } from "../shared/dates";
import { formatTime, formatTokens } from "../shared/format";
import {
  CHATGPT_CODEX_CREDITS_KEY,
  CHATGPT_CODEX_WORKSPACE_KEYS,
  chatgptLimitMetricKey,
  chatgptModelMetricKey,
  GEMINI_CREDITS_KEY,
  GEMINI_ANTIGRAVITY_CREDITS_KEY,
  geminiAntigravityModelMetricKey,
  geminiFeatureMetricKey,
} from "../shared/metricKeys";
import type { InsightsSummary } from "../shared/messages";
import { PLATFORMS, type Platform } from "../shared/platform";
import { PLATFORM_LABELS } from "../shared/platformMeta";
import {
  addCodexLimitMeter,
  addQuotaMeter,
  anyMetricChangedRecently,
  asNumber,
  cleanLabel,
  computeTrend,
  detailWithReset,
  estimatedTokenTotal,
  metricChangedRecently,
  sumCodexWorkspace,
  type Meter,
} from "./meters";

export function loadInsights() {
  chrome.runtime.sendMessage({ type: "insights-get-summary" }, (resp: InsightsSummary | undefined) => {
    if (!resp) return;
    const { subs, today, remark, weekData, prevWeekData } = resp;

    // Spend card
    let totalSpend = 0;
    const breakdownEl = document.getElementById("spendBreakdown")!;
    breakdownEl.innerHTML = "";
    for (const p of PLATFORMS) {
      const sub = subs?.[p];
      const price = sub?.price || 0;
      totalSpend += price;
      const item = document.createElement("span");
      item.className = `spend-item ${p}`;
      item.innerHTML = `<span class="dot"></span>${PLATFORM_LABELS[p]} ${sub?.label || "?"} $${price}`;
      breakdownEl.appendChild(item);
    }
    document.getElementById("spendAmount")!.textContent = `$${totalSpend.toFixed(2)}`;

    // Today card
    let todaySeconds = 0, todayMsgs = 0, todayTokens = 0;
    for (const p of PLATFORMS) {
      const d = today?.[p];
      if (!d) continue;
      todaySeconds += d.totalSeconds || 0;
      todayMsgs += d.messageCount || 0;
      todayTokens += estimatedTokenTotal(d);
    }
    document.getElementById("todayTime")!.textContent = formatTime(todaySeconds);
    document.getElementById("todayMsgs")!.textContent = String(todayMsgs);
    document.getElementById("todayTokens")!.textContent = formatTokens(todayTokens);

    // Time bar
    const timeBar = document.getElementById("todayTimeBar")!;
    timeBar.innerHTML = "";
    if (todaySeconds > 0) {
      for (const p of PLATFORMS) {
        const s = today?.[p]?.totalSeconds || 0;
        if (s <= 0) continue;
        const seg = document.createElement("div");
        seg.className = `time-bar-seg ${p}`;
        seg.style.width = `${(s / todaySeconds) * 100}%`;
        timeBar.appendChild(seg);
      }
    }

    // Per-platform breakdown (time + msgs per platform)
    const bdEl = document.getElementById("platformBreakdown")!;
    bdEl.innerHTML = "";
    for (const p of PLATFORMS) {
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
    const metersEl = document.getElementById("usageMeters")!;
    const meters: Meter[] = [];

    // Collect raw meter data per platform, then filter
    const rawMeters: Record<Platform, Meter[]> = { claude: [], chatgpt: [], gemini: [] };

    // Claude: real utilization from API
    if (platformUsage?.claude?.fiveHour || platformUsage?.claude?.sevenDay) {
      const cu = platformUsage.claude;
      const fiveHourUtil = asNumber(cu.fiveHour?.utilization);
      const sevenDayUtil = asNumber(cu.sevenDay?.utilization);
      if (fiveHourUtil != null) rawMeters.claude.push({ label: "Claude 5h", pct: Math.round(fiveHourUtil), ...detailWithReset(`${Math.round(fiveHourUtil)}%`, cu.fiveHour), color: "#D97706", alwaysShow: true, quota: true, fullAvailable: fiveHourUtil <= 0 });
      if (sevenDayUtil != null) rawMeters.claude.push({ label: "Claude 7d", pct: Math.round(sevenDayUtil), ...detailWithReset(`${Math.round(sevenDayUtil)}%`, cu.sevenDay), color: "#D97706", alwaysShow: true, quota: true, fullAvailable: sevenDayUtil <= 0 });
    }

    // ChatGPT/Codex: provider-backed usage.
    const gptUsage = platformUsage?.chatgpt;
    const GPT_LABELS: Record<string, string> = { deep_research: "Research", odyssey: "Reasoning", image_gen: "Images" };
    const gptChat = gptUsage?.chat || gptUsage;
    // Metric key builders live in shared/metricKeys.ts.
    for (const ml of (gptChat?.modelLimits || []).slice(0, 4)) {
      const key = chatgptModelMetricKey(ml.model || ml.name || ml.feature);
      addQuotaMeter(rawMeters.chatgpt, `ChatGPT ${cleanLabel(ml.model, "GPT")}`, ml, "#4285F4", {
        requiresRecentDelta: true,
        changedWithin24h: metricChangedRecently(gptUsage, key),
      });
    }
    for (const lp of (gptChat?.limits || [])) {
      const key = chatgptLimitMetricKey(lp.feature || lp.name);
      addQuotaMeter(rawMeters.chatgpt, `ChatGPT ${GPT_LABELS[lp.feature] || cleanLabel(lp.feature, "GPT")}`, lp, "#4285F4", {
        requiresRecentDelta: true,
        changedWithin24h: metricChangedRecently(gptUsage, key),
      });
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
        requiresRecentDelta: true,
        changedWithin24h: metricChangedRecently(gptUsage, CHATGPT_CODEX_CREDITS_KEY),
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
        requiresRecentDelta: true,
        changedWithin24h: anyMetricChangedRecently(gptUsage, CHATGPT_CODEX_WORKSPACE_KEYS),
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

    // Gemini: one daily credit pool shared by premium features (Pro ≈ 19/msg,
    // Flash-Lite free). Per-feature rows are a legacy shape, kept as fallback.
    const gemUsage = platformUsage?.gemini;
    const gemCredits = gemUsage?.credits;
    if ((asNumber(gemCredits?.limit) ?? 0) > 0) {
      addQuotaMeter(rawMeters.gemini, "Gemini credits", gemCredits, "#10A37F", {
        requiresRecentDelta: true,
        changedWithin24h: metricChangedRecently(gemUsage, GEMINI_CREDITS_KEY),
      });
    } else if (gemUsage?.features?.length > 0) {
      const proChat = gemUsage.features.find((f: any) => f.id === 4);
      const thinking = gemUsage.features.find((f: any) => f.id === 15);
      const preferred = [proChat, thinking].filter(Boolean);
      for (const f of preferred) {
        addQuotaMeter(rawMeters.gemini, f.name, f, "#10A37F", {
          requiresRecentDelta: true,
          changedWithin24h: metricChangedRecently(gemUsage, geminiFeatureMetricKey(f.id)),
        });
      }
      if (preferred.length === 0) {
        const fullAvailable = gemUsage.features.every((f: any) => {
          const limit = asNumber(f?.limit);
          const remaining = asNumber(f?.remaining);
          return limit != null && remaining != null && limit > 0 && remaining >= limit;
        });
        rawMeters.gemini.push({
          label: "Gemini",
          pct: 0,
          color: "#10A37F",
          alwaysShow: true,
          quota: true,
          fullAvailable,
        });
      }
    }

    // Antigravity CLI: Google Cloud Code quota under the signed-in Gemini account.
    // Kept in its OWN meter group (not rawMeters.gemini) so a connected-but-fully-
    // available account still renders its own "Antigravity 0%" row alongside
    // "Gemini 0%", instead of collapsing into the Gemini fallback.
    const antUsage = gemUsage?.antigravity;
    const agMeters: Meter[] = [];
    if ((asNumber(antUsage?.credits?.limit) ?? 0) > 0) {
      addQuotaMeter(agMeters, "Antigravity credits", antUsage.credits, "#A142F4", {
        requiresRecentDelta: true,
        changedWithin24h: metricChangedRecently(gemUsage, GEMINI_ANTIGRAVITY_CREDITS_KEY),
      });
    }
    const antModels = Array.isArray(antUsage?.models) ? [...antUsage.models] : [];
    antModels.sort((a: any, b: any) => (asNumber(b?.usedPct) || 0) - (asNumber(a?.usedPct) || 0));
    for (const m of antModels.slice(0, 4)) {
      const id = m?.id || m?.modelId || m?.model;
      if (id == null) continue;
      addQuotaMeter(agMeters, `Antigravity ${cleanLabel(m?.name || m?.label || id, "Model")}`, m, "#A142F4", {
        requiresRecentDelta: true,
        changedWithin24h: metricChangedRecently(gemUsage, geminiAntigravityModelMetricKey(id)),
      });
    }

    // Used percentage quota rows stay visible; fully available quotas collapse
    // to one platform row. Number-only rows are gated by deltas.
    const PLATFORM_FALLBACK: Record<Platform, { label: string; color: string }> = {
      claude: { label: "Claude", color: "#D97706" },
      chatgpt: { label: "ChatGPT", color: "#4285F4" },
      gemini: { label: "Gemini", color: "#10A37F" },
    };
    const shouldShowMeter = (m: Meter) => !m.requiresRecentDelta || m.changedWithin24h;
    for (const p of PLATFORMS) {
      const pm = rawMeters[p];
      if (pm.length === 0) continue;
      const pctMeters = pm.filter((m) => m.pct != null);
      const activePctMeters = pctMeters.filter((m) => (m.pct ?? 0) > 0);
      const detailMeters = pm.filter((m) => m.pct == null && shouldShowMeter(m) && (m.alwaysShow || m.detail));
      const visibleMeters = [...activePctMeters, ...detailMeters];
      if (visibleMeters.length > 0) {
        meters.push(...visibleMeters);
      } else {
        meters.push({ label: PLATFORM_FALLBACK[p].label, pct: 0, color: PLATFORM_FALLBACK[p].color, alwaysShow: true, quota: true, fullAvailable: true });
      }
    }

    // Antigravity group: a connected account always reads as tracked — its used
    // models when there's usage, otherwise one "Antigravity 0%" row (mirrors the
    // per-platform fallback so a fully-available connection still shows, beside
    // "Gemini 0%"). Nothing shows when not connected (no antigravity block).
    if (antUsage) {
      const activeAg = agMeters.filter((m) => m.pct != null && (m.pct ?? 0) > 0);
      const detailAg = agMeters.filter((m) => m.pct == null && shouldShowMeter(m) && (m.alwaysShow || m.detail));
      const visibleAg = [...activeAg, ...detailAg];
      if (visibleAg.length > 0) {
        meters.push(...visibleAg);
      } else {
        meters.push({ label: "Antigravity", pct: 0, color: "#A142F4", alwaysShow: true, quota: true, fullAvailable: true });
      }
    }

    if (meters.length > 0) {
      metersEl.innerHTML = "";
      metersEl.style.display = "";
      for (const m of meters) {
        const fillColor = m.pct != null && m.pct >= 90 ? "#ff6b6b" : m.color;
        const row = document.createElement("div");
        row.className = "usage-meter";
        if (m.title) row.title = m.title;
        const labelBlock = document.createElement("span");
        labelBlock.className = "usage-meter-label-block";
        const label = document.createElement("span");
        label.className = "usage-meter-label";
        label.style.color = fillColor;
        label.textContent = m.label;
        labelBlock.appendChild(label);
        if (m.reset) {
          const reset = document.createElement("span");
          reset.className = "usage-meter-reset";
          reset.textContent = m.reset;
          if (m.title) reset.title = m.title;
          labelBlock.appendChild(reset);
        }
        row.appendChild(labelBlock);
        if (m.pct == null) {
          const detail = document.createElement("span");
          detail.className = "usage-meter-detail";
          detail.style.color = fillColor;
          detail.textContent = m.detail || "";
          if (m.title) detail.title = m.title;
          row.appendChild(detail);
        } else {
          const track = document.createElement("div");
          track.className = "usage-meter-track";
          const fill = document.createElement("div");
          fill.className = "usage-meter-fill";
          fill.style.width = Math.max(m.pct, 2) + "%";
          fill.style.background = fillColor;
          track.appendChild(fill);
          row.appendChild(track);

          const pct = document.createElement("span");
          pct.className = "usage-meter-pct";
          pct.style.color = fillColor;
          pct.textContent = m.detail || (m.pct + "%");
          if (m.title) pct.title = m.title;
          row.appendChild(pct);
        }
        metersEl.appendChild(row);
      }
    }

    // Weekly sparkline
    const weekDays: (Record<string, any> | null)[] = [];
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
      for (const p of PLATFORMS) {
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

    // Build date strings for each of the 7 days
    const dayDates: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayDates.push(d);
    }

    const maxDaySeconds = Math.max(...dayTotals.map((d) => d.total), 1);
    const sparkline = document.getElementById("weekSparkline")!;
    sparkline.innerHTML = "";
    const dayLabels = document.getElementById("weekDayLabels")!;
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
        for (const p of PLATFORMS) {
          if (day[p] > 0) parts.push(`  ${PLATFORM_LABELS[p]}: ${formatTime(day[p])}`);
        }
      } else {
        parts.push("No activity");
      }
      bar.setAttribute("data-tooltip", parts.join("\n"));

      for (const p of ["gemini", "chatgpt", "claude"] as const) {
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
    document.getElementById("weekTotal")!.textContent =
      `${(weekTotalSeconds / 3600).toFixed(1)}h total`;

    // Week trend
    let prevWeekSeconds = 0;
    if (prevWeekData) {
      for (const k of Object.keys(prevWeekData)) {
        const day = prevWeekData[k];
        if (!day) continue;
        for (const p of PLATFORMS) {
          prevWeekSeconds += day[p]?.totalSeconds || 0;
        }
      }
    }
    const weekTrend = computeTrend(weekTotalSeconds, prevWeekSeconds);
    const weekTrendEl = document.getElementById("weekTrend")!;
    if (weekTrend.dir !== "flat" || prevWeekSeconds > 0) {
      weekTrendEl.className = `trend-badge ${weekTrend.dir}`;
      weekTrendEl.textContent = weekTrend.dir === "up"
        ? `↑${weekTrend.pct}%`
        : weekTrend.dir === "down" ? `↓${Math.abs(weekTrend.pct)}%` : "—";
    }

    // Token sparkline
    const maxDayTokens = Math.max(...dayTotals.map((d) => d.tokens), 1);
    let weekTotalTokens = 0;
    const tokenSparkline = document.getElementById("tokenSparkline")!;
    tokenSparkline.innerHTML = "";
    const tokenDayLabels = document.getElementById("tokenDayLabels")!;
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
    document.getElementById("tokenTotal")!.textContent = formatTokens(weekTotalTokens) + " total";

    // Token trend
    let prevWeekTokens = 0;
    if (prevWeekData) {
      for (const k of Object.keys(prevWeekData)) {
        const day = prevWeekData[k];
        if (!day) continue;
        for (const p of PLATFORMS) {
          prevWeekTokens += estimatedTokenTotal(day[p]);
        }
      }
    }
    const tokenTrend = computeTrend(weekTotalTokens, prevWeekTokens);
    const tokenTrendEl = document.getElementById("tokenTrend")!;
    if (tokenTrend.dir !== "flat" || prevWeekTokens > 0) {
      tokenTrendEl.className = `trend-badge ${tokenTrend.dir}`;
      tokenTrendEl.textContent = tokenTrend.dir === "up"
        ? `↑${tokenTrend.pct}%`
        : tokenTrend.dir === "down" ? `↓${Math.abs(tokenTrend.pct)}%` : "—";
    }

    // Remark (right side of header)
    const remarkEl = document.getElementById("remark")!;
    if (remark?.text) {
      remarkEl.textContent = remark.text;
      remarkEl.classList.add("active");
    }
  });
}
