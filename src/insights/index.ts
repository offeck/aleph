import { usageKeyForDate } from "../shared/dates";
import { formatTime, formatTokens } from "../shared/format";
import { PLATFORMS } from "../shared/platform";
import { PLATFORM_LABELS } from "../shared/platformMeta";
import { PRICING } from "../shared/pricing";

(function () {
  "use strict";

  function normalizeStoredPlan(platform, sub) {
    var plan = (sub && sub.plan) || "free";
    if (platform === "chatgpt" && plan === "pro") {
      return sub && sub.price === 200 ? "pro20x" : "pro5x";
    }
    return plan;
  }

  // ── Subscriptions ───────────────────────────────────────
  function loadSubscriptions(subs, today) {
    var totalSpend = 0;
    for (var i = 0; i < PLATFORMS.length; i++) {
      var p = PLATFORMS[i];
      var sub = subs[p] || {};
      var cardId = "sub" + p.charAt(0).toUpperCase() + p.slice(1);
      var card = document.getElementById(cardId);
      if (!card) continue;

      var plan = normalizeStoredPlan(p, sub);
      var pricing = PRICING[p][plan] || PRICING[p].free;
      var price = sub.price != null ? sub.price : pricing.price;
      totalSpend += price;

      card.querySelector(".plan-badge").textContent = sub.plan === plan && sub.label ? sub.label : pricing.label;
      card.querySelector(".sub-price").textContent = price > 0 ? "$" + price + "/mo" : "Free";
      card.querySelector(".model-name").textContent = sub.model || "Default model";

      var dayData = today[p] || {};
      card.querySelector(".tokens-in").textContent = formatTokens(dayData.tokensIn) + " in";
      card.querySelector(".tokens-out").textContent = formatTokens(dayData.tokensOut) + " out";
    }
    document.getElementById("totalSpend").textContent = "$" + totalSpend.toFixed(2) + " / month";
  }

  // ── Hourly Chart ────────────────────────────────────────
  function loadHourlyChart(today) {
    var chart = document.getElementById("hourChart");
    chart.innerHTML = "";

    // Find max seconds in any hour across all platforms
    var maxSeconds = 1;
    for (var h = 0; h < 24; h++) {
      var hourTotal = 0;
      for (var i = 0; i < PLATFORMS.length; i++) {
        var p = PLATFORMS[i];
        var hours = (today[p] && today[p].hours) || {};
        hourTotal += hours[String(h)] || 0;
      }
      if (hourTotal > maxSeconds) maxSeconds = hourTotal;
    }

    for (var h = 0; h < 24; h++) {
      var bar = document.createElement("div");
      bar.className = "hour-bar";

      for (var i = 0; i < PLATFORMS.length; i++) {
        var p = PLATFORMS[i];
        var hours = (today[p] && today[p].hours) || {};
        var secs = hours[String(h)] || 0;
        if (secs > 0) {
          var fill = document.createElement("div");
          fill.className = "bar-fill " + p;
          fill.style.height = (secs / maxSeconds * 100) + "%";
          bar.appendChild(fill);
        }
      }

      // Add label every 3 hours
      if (h % 3 === 0) {
        var label = document.createElement("div");
        label.className = "hour-label";
        label.textContent = String(h);
        bar.appendChild(label);
      }

      chart.appendChild(bar);
    }
  }

  // ── Today Table ─────────────────────────────────────────
  function loadTodayTable(today) {
    var table = document.getElementById("statsTable");
    // Remove existing rows but keep header
    var rows = table.querySelectorAll(".stats-row");
    for (var r = 0; r < rows.length; r++) rows[r].remove();

    var totals = { time: 0, msgs: 0, tokensIn: 0, tokensOut: 0 };

    for (var i = 0; i < PLATFORMS.length; i++) {
      var p = PLATFORMS[i];
      var d = today[p] || {};
      var secs = d.totalSeconds || 0;
      var msgs = d.messageCount || 0;
      var tIn = d.tokensIn || 0;
      var tOut = d.tokensOut || 0;

      totals.time += secs;
      totals.msgs += msgs;
      totals.tokensIn += tIn;
      totals.tokensOut += tOut;

      var row = document.createElement("div");
      row.className = "stats-row";
      row.innerHTML =
        '<span class="platform-name ' + p + '">' + PLATFORM_LABELS[p] + "</span>" +
        "<span>" + formatTime(secs) + "</span>" +
        "<span>" + msgs + "</span>" +
        "<span>" + formatTokens(tIn) + "</span>" +
        "<span>" + formatTokens(tOut) + "</span>";
      table.appendChild(row);
    }

    var totalsRow = document.createElement("div");
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
  function loadWeekSummary(weekData) {
    var grid = document.getElementById("weekGrid");
    grid.innerHTML = "";

    var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var now = new Date();
    var days = [];
    var maxSecs = 1;

    for (var i = 6; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var key = usageKeyForDate(d);
      var dayData = weekData[key] || null;
      var totalSecs = 0;
      if (dayData) {
        for (var j = 0; j < PLATFORMS.length; j++) {
          totalSecs += (dayData[PLATFORMS[j]] && dayData[PLATFORMS[j]].totalSeconds) || 0;
        }
      }
      if (totalSecs > maxSecs) maxSecs = totalSecs;
      days.push({ date: d, totalSecs: totalSecs });
    }

    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      var card = document.createElement("div");
      card.className = "day-card";

      var name = document.createElement("div");
      name.className = "day-name";
      name.textContent = DAY_NAMES[day.date.getDay()];

      var time = document.createElement("div");
      time.className = "day-time";
      time.textContent = formatTime(day.totalSecs);

      var track = document.createElement("div");
      track.className = "day-bar-track";
      var fill = document.createElement("div");
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
  function loadPredictions(weekData) {
    var now = new Date();
    var weekSeconds = 0;

    for (var i = 0; i < 7; i++) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var key = usageKeyForDate(d);
      var dayData = weekData[key];
      if (!dayData) continue;
      for (var j = 0; j < PLATFORMS.length; j++) {
        weekSeconds += (dayData[PLATFORMS[j]] && dayData[PLATFORMS[j]].totalSeconds) || 0;
      }
    }

    var weekHours = weekSeconds / 3600;
    var dayOfWeek = now.getDay() || 7;
    var projectedWeekHours = dayOfWeek > 0 ? (weekHours / dayOfWeek) * 7 : weekHours;
    var projectedMonthHours = projectedWeekHours * 4.3;

    document.getElementById("predWeek").textContent = projectedWeekHours.toFixed(1) + "h";
    document.getElementById("predMonth").textContent = projectedMonthHours.toFixed(1) + "h";
  }

  // ── Remark ──────────────────────────────────────────────
  function loadRemark(remark) {
    var el = document.getElementById("remarkText");
    if (remark && remark.text) {
      el.textContent = remark.text;
    } else {
      el.textContent = "Use AI chat platforms to start tracking.";
    }
  }

  // ── Manual Overrides ────────────────────────────────────
  function bindOverrides(subs) {
    for (var i = 0; i < PLATFORMS.length; i++) {
      (function (p) {
        var selectId = "override" + p.charAt(0).toUpperCase() + p.slice(1);
        var select = document.getElementById(selectId);
        if (!select) return;

        // Set current value
        var sub = subs[p] || {};
        var plan = normalizeStoredPlan(p, sub);
        if (plan && select.querySelector('option[value="' + plan + '"]')) {
          select.value = plan;
        }

        select.addEventListener("change", function () {
          var plan = select.value;
          var pricing = PRICING[p][plan] || PRICING[p].free;
          chrome.storage.local.get({ insights_subscriptions: {} }, function (result) {
            var allSubs = result.insights_subscriptions;
            allSubs[p] = {
              plan: plan,
              price: pricing.price,
              label: pricing.label,
              model: (allSubs[p] && allSubs[p].model) || "Default model",
              detectedAt: Date.now(),
              manualOverride: true,
            };
            chrome.storage.local.set({ insights_subscriptions: allSubs }, function () {
              // Refresh subscriptions display
              var todayKey = usageKeyForDate();
              chrome.storage.local.get({ [todayKey]: {}, insights_subscriptions: {} }, function (r) {
                loadSubscriptions(r.insights_subscriptions, r[todayKey]);
              });
            });
          });
        });
      })(PLATFORMS[i]);
    }
  }

  // ── Init ────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    chrome.runtime.sendMessage({ type: "insights-get-summary" }, function (resp) {
      if (!resp) return;
      var subs = resp.subs || {};
      var today = resp.today || {};
      var remark = resp.remark || null;
      var weekData = resp.weekData || {};

      loadSubscriptions(subs, today);
      loadHourlyChart(today);
      loadTodayTable(today);
      loadWeekSummary(weekData);
      loadPredictions(weekData);
      loadRemark(remark);
      bindOverrides(subs);
    });

    // Also read subscriptions directly for freshest override data
    chrome.storage.local.get({ insights_subscriptions: {} }, function (result) {
      var subs = result.insights_subscriptions;
      for (var i = 0; i < PLATFORMS.length; i++) {
        var p = PLATFORMS[i];
        var sub = subs[p] || {};
        var selectId = "override" + p.charAt(0).toUpperCase() + p.slice(1);
        var select = document.getElementById(selectId);
        var plan = normalizeStoredPlan(p, sub);
        if (select && plan && select.querySelector('option[value="' + plan + '"]')) {
          select.value = plan;
        }
      }
    });
  });
})();
