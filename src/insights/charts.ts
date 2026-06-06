import { usageKeyForDate } from "../shared/dates";
import { formatTime, formatTokens } from "../shared/format";
import type { StoredRemark } from "../shared/messages";
import { PLATFORMS } from "../shared/platform";
import { PLATFORM_LABELS } from "../shared/platformMeta";

// Usage-day docs are raw storage JSON — boundary `any` records, read
// defensively.

// ── Hourly Chart ────────────────────────────────────────
export function loadHourlyChart(today: Record<string, any>) {
  const chart = document.getElementById("hourChart")!;
  chart.innerHTML = "";

  // Find max seconds in any hour across all platforms
  let maxSeconds = 1;
  for (let h = 0; h < 24; h++) {
    let hourTotal = 0;
    for (const p of PLATFORMS) {
      const hours = (today[p] && today[p].hours) || {};
      hourTotal += hours[String(h)] || 0;
    }
    if (hourTotal > maxSeconds) maxSeconds = hourTotal;
  }

  for (let h = 0; h < 24; h++) {
    const bar = document.createElement("div");
    bar.className = "hour-bar";

    for (const p of PLATFORMS) {
      const hours = (today[p] && today[p].hours) || {};
      const secs = hours[String(h)] || 0;
      if (secs > 0) {
        const fill = document.createElement("div");
        fill.className = "bar-fill " + p;
        fill.style.height = (secs / maxSeconds * 100) + "%";
        bar.appendChild(fill);
      }
    }

    // Add label every 3 hours
    if (h % 3 === 0) {
      const label = document.createElement("div");
      label.className = "hour-label";
      label.textContent = String(h);
      bar.appendChild(label);
    }

    chart.appendChild(bar);
  }
}

// ── Today Table ─────────────────────────────────────────
export function loadTodayTable(today: Record<string, any>) {
  const table = document.getElementById("statsTable")!;
  // Remove existing rows but keep header
  table.querySelectorAll(".stats-row").forEach((row) => row.remove());

  const totals = { time: 0, msgs: 0, tokensIn: 0, tokensOut: 0 };

  for (const p of PLATFORMS) {
    const d = today[p] || {};
    const secs = d.totalSeconds || 0;
    const msgs = d.messageCount || 0;
    const tIn = d.tokensIn || 0;
    const tOut = d.tokensOut || 0;

    totals.time += secs;
    totals.msgs += msgs;
    totals.tokensIn += tIn;
    totals.tokensOut += tOut;

    const row = document.createElement("div");
    row.className = "stats-row";
    row.innerHTML =
      '<span class="platform-name ' + p + '">' + PLATFORM_LABELS[p] + "</span>" +
      "<span>" + formatTime(secs) + "</span>" +
      "<span>" + msgs + "</span>" +
      "<span>" + formatTokens(tIn) + "</span>" +
      "<span>" + formatTokens(tOut) + "</span>";
    table.appendChild(row);
  }

  const totalsRow = document.createElement("div");
  totalsRow.className = "stats-row totals-row";
  totalsRow.innerHTML =
    "<span>Total</span>" +
    "<span>" + formatTime(totals.time) + "</span>" +
    "<span>" + totals.msgs + "</span>" +
    "<span>" + formatTokens(totals.tokensIn) + "</span>" +
    "<span>" + formatTokens(totals.tokensOut) + "</span>";
  table.appendChild(totalsRow);
}

// ── Week Summary ────────────────────────────────────────
export function loadWeekSummary(weekData: Record<string, any>) {
  const grid = document.getElementById("weekGrid")!;
  grid.innerHTML = "";

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const days: { date: Date; totalSecs: number }[] = [];
  let maxSecs = 1;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = usageKeyForDate(d);
    const dayData = weekData[key] || null;
    let totalSecs = 0;
    if (dayData) {
      for (const p of PLATFORMS) {
        totalSecs += (dayData[p] && dayData[p].totalSeconds) || 0;
      }
    }
    if (totalSecs > maxSecs) maxSecs = totalSecs;
    days.push({ date: d, totalSecs: totalSecs });
  }

  for (const day of days) {
    const card = document.createElement("div");
    card.className = "day-card";

    const name = document.createElement("div");
    name.className = "day-name";
    name.textContent = DAY_NAMES[day.date.getDay()];

    const time = document.createElement("div");
    time.className = "day-time";
    time.textContent = formatTime(day.totalSecs);

    const track = document.createElement("div");
    track.className = "day-bar-track";
    const fill = document.createElement("div");
    fill.className = "day-bar-fill";
    fill.style.width = (day.totalSecs / maxSecs * 100) + "%";
    track.appendChild(fill);

    card.appendChild(name);
    card.appendChild(time);
    card.appendChild(track);
    grid.appendChild(card);
  }
}

// ── Predictions ─────────────────────────────────────────
export function loadPredictions(weekData: Record<string, any>) {
  const now = new Date();
  let weekSeconds = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = usageKeyForDate(d);
    const dayData = weekData[key];
    if (!dayData) continue;
    for (const p of PLATFORMS) {
      weekSeconds += (dayData[p] && dayData[p].totalSeconds) || 0;
    }
  }

  const weekHours = weekSeconds / 3600;
  const dayOfWeek = now.getDay() || 7;
  const projectedWeekHours = dayOfWeek > 0 ? (weekHours / dayOfWeek) * 7 : weekHours;
  const projectedMonthHours = projectedWeekHours * 4.3;

  document.getElementById("predWeek")!.textContent = projectedWeekHours.toFixed(1) + "h";
  document.getElementById("predMonth")!.textContent = projectedMonthHours.toFixed(1) + "h";
}

// ── Remark ──────────────────────────────────────────────
export function loadRemark(remark: StoredRemark | null) {
  const el = document.getElementById("remarkText")!;
  if (remark && remark.text) {
    el.textContent = remark.text;
  } else {
    el.textContent = "Use AI chat platforms to start tracking.";
  }
}
