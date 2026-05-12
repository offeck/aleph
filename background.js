importScripts(
  "vendor/firebase/firebase-app-compat.js",
  "vendor/firebase/firebase-auth-compat.js",
  "vendor/firebase/firebase-firestore-compat.js",
  "vendor/firebase/firebase-config.js",
  "sync.js"
);

if (ALEPH_FIREBASE_CONFIG.apiKey !== "PLACEHOLDER") {
  firebase.initializeApp(ALEPH_FIREBASE_CONFIG);
  alephSync.init(firebase);
  alephSync.restoreAuth();
}

"use strict";

// ── Helpers ──────────────────────────────────────────────
function todayKey() {
  return "usage_" + new Date().toISOString().slice(0, 10);
}

function emptyPlatformDay() {
  return { totalSeconds: 0, messageCount: 0, hours: {}, tokensIn: 0, tokensOut: 0 };
}

async function readLocal(key, fallback) {
  const result = await chrome.storage.local.get({ [key]: fallback });
  return result[key];
}

async function writeLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
  if (key.startsWith("usage_") || key === "insights_subscriptions") {
    try { alephSync.maybePush(key, value); } catch (e) {}
  }
}

// ── Remark engine ────────────────────────────────────────
const REMARKS = {
  lateNight: {
    condition: (d) => d.hour >= 0 && d.hour < 5 && d.todayActive,
    pool: [
      "{platform} at {hour}am? We don't judge... much.",
      "The AI never sleeps. Apparently, neither do you.",
      "Midnight oil and AI chats. Name a more iconic duo.",
      "The best prompts are written at {hour}am. Said no one ever.",
      "Your sleep schedule called. It wants a word.",
      "Fun fact: AI responses at 3am aren't better. But we respect the grind.",
      "Night owl mode: activated. Productivity: questionable.",
      "Plot twist: {platform} is the reason you can't sleep.",
      "You and {platform} are the only ones awake right now. Romantic.",
      "At {hour}am, every prompt feels like a masterpiece. It's not.",
      "Your circadian rhythm just filed a complaint.",
      "If insomnia was a sport, you'd be going pro.",
      "NASA called — they can see your screen glow from orbit.",
      "Late-night AI usage: because bad decisions need a thought partner.",
      "Somewhere, a sleep researcher is writing a paper about you.",
    ],
  },
  longSession: {
    condition: (d) => d.maxPlatformMinutes >= 120,
    pool: [
      "{minutes} minutes on {platform} today. Even AI needs a coffee break.",
      "You've been chatting with {platform} longer than most meetings last.",
      "{platform} marathon session! Have you considered hydrating?",
      "{minutes} minutes and counting. {platform} knows you better than your therapist.",
      "That's {hoursRound} hours of pure human-AI synergy.",
      "Impressive stamina. {platform} is probably tired too.",
      "You and {platform}, sitting in a tree... P-R-O-M-P-T-I-N-G.",
      "{hoursRound} hours. Your chair called — it needs a break too.",
      "You've been at this longer than most Marvel movies. Respect.",
      "At {minutes} minutes, {platform} is your longest conversation today. Including humans.",
      "{platform} has seen your best work and your worst typos.",
      "If {platform} could order you food, it would have by now.",
      "Your keyboard deserves hazard pay after {minutes} minutes.",
      "{hoursRound} hours straight? That's not a session, that's a relationship.",
      "Your posture during this {minutes}-minute session: concerning.",
    ],
  },
  tokenHeavy: {
    condition: (d) => d.todayTokensK >= 50,
    pool: [
      "~{todayTokensK}K tokens today. That's a small novel.",
      "Your AI wrote ~{todayTokensK}K tokens for you today. What a time to be alive.",
      "Token machine go brrrr. ~{todayTokensK}K and counting.",
      "At ~{todayTokensK}K tokens, you're basically co-authoring with AI.",
      "~{todayTokensK}K tokens. Somewhere, a GPU is warm because of you.",
      "That's ~{todayTokensK}K tokens of pure wisdom. Probably.",
      "~{todayTokensK}K tokens — that's more words than most Tinder profiles.",
      "You've burned through ~{todayTokensK}K tokens. The data center felt that.",
      "At this token rate, you're single-handedly funding AI research.",
      "~{todayTokensK}K tokens. Your electricity bill is blushing.",
      "Tolstoy wrote War and Peace with fewer characters than your {todayTokensK}K.",
      "~{todayTokensK}K tokens: the director's cut of your thoughts.",
      "If tokens were frequent flyer miles, you'd be in first class.",
    ],
  },
  multiPlatform: {
    condition: (d) => d.platformCount >= 3,
    pool: [
      "Claude, ChatGPT, AND Gemini? Playing the field, are we?",
      "3 AI platforms today. Someone's doing a competitive analysis.",
      "Triple threat AI user detected. Respect.",
      "Why pick one AI when you can have them all?",
      "Diversifying your AI portfolio. Smart move.",
      "Three AIs walk into a browser tab... and you talked to all of them.",
      "You're like a bee pollinating between AI flowers. Majestic.",
      "Using all 3 AIs? You must be settling an argument between them.",
      "One AI for each mood. We get it.",
      "Playing AIs against each other? That's either genius or supervillain behavior.",
      "Triple-booking AI chats like a true power user.",
      "When one AI says no, you have two backups. Strategy.",
      "Claude for poetry, ChatGPT for code, Gemini for... we won't ask.",
    ],
  },
  highSpend: {
    condition: (d) => d.totalMonthly >= 40,
    pool: [
      "You're spending more on AI than on Netflix. Worth it.",
      "${total}/month on AI. Your future self says thanks.",
      "That's a nice dinner... or a month of AI. You chose wisely.",
      "${total}/month — cheaper than hiring an intern.",
      "Your AI budget could buy {coffees} coffees a month.",
      "${total}/month to talk to machines. Welcome to the future.",
      "At ${total}/month, each AI response costs you about... never mind.",
      "${total}/month. But can you really put a price on procrastination?",
      "Your bank statement just has {coffees} lines that say 'AI subscription'.",
      "${total}/month. Cheaper than therapy, more productive than Twitter.",
      "You're basically an angel investor in AI. A small angel. With a subscription.",
      "For ${total}/month you get unlimited AI wisdom. And unlimited distraction.",
      "${total}/month — your accountant has questions.",
      "That's {coffees} avocado toasts worth of AI per month. Millennials approve.",
    ],
  },
  prediction: {
    condition: (d) => d.weekHours > 0,
    pool: [
      "At this rate, you'll use {weekHours}h of AI this week. Almost a part-time job.",
      "Projected {weekHours}h this week. The AI is getting to know you.",
      "On track for {monthHours}h this month. Impressive dedication.",
      "Weekly forecast: {weekHours}h of asking machines to think for you.",
      "{weekHours}h this week and climbing. You're in the AI power user club.",
      "By Friday, you'll have spent {weekHours}h with AI. Plan your alibi.",
      "{weekHours}h projected. At this pace, AI owes YOU a salary.",
      "At {weekHours}h/week, you'll hit expert level by... next week.",
      "{monthHours}h this month. That's more screen time than a Netflix binge.",
      "If AI usage was tracked on Strava, you'd be top of the leaderboard.",
      "Pace: {weekHours}h/week. Vibe: unstoppable. Posture: debatable.",
      "{weekHours}h this week? Somewhere, an AI is bragging about you to other AIs.",
    ],
  },
  earlyBird: {
    condition: (d) => d.hour >= 5 && d.hour < 8 && d.todayActive,
    pool: [
      "Starting the day with AI. Coffee hasn't even kicked in yet.",
      "Early morning AI session. Productive or procrastinating?",
      "Good morning! You and the AI are both just waking up.",
      "6am prompt engineering. Peak performance.",
      "Birds are singing, sun is rising, and you're prompting. Priorities.",
      "The early bird gets the... best AI responses? Sure, let's go with that.",
      "Your alarm: *beep*. You: 'Hey {platform}, quick question...'",
      "Morning routine: coffee, AI, contemplate existence. In that order.",
      "You prompt before you brush your teeth. No judgment. Okay, a little.",
      "Rise and grind — literally, you're grinding tokens at {hour}am.",
      "Dawn patrol prompting. The AI appreciates your punctuality.",
      "Sunrise, coffee, {platform}. The holy trinity.",
    ],
  },
  evening: {
    condition: (d) => d.hour >= 20 && d.hour < 24 && d.todayActive,
    pool: [
      "Evening AI session. Is this winding down or ramping up?",
      "Other people watch TV at night. You train AI. Different breed.",
      "Nighttime prompting: where all the 'just one more question' happens.",
      "{platform} is your evening entertainment. Better than most shows, honestly.",
      "The sun set {sunHoursAgo} hours ago. Just saying.",
      "Prime-time TV vs. prime-time AI. You made your choice.",
      "This is the part of the night where prompts get philosophical.",
      "Evening mode: when 'let me ask AI real quick' becomes 2 hours.",
      "Your browser tabs at {hour}pm: AI chat, AI chat, AI chat, and one recipe you'll never cook.",
      "Winding down with some light AI conversation. Totally normal behavior.",
    ],
  },
  weekend: {
    condition: (d) => d.isWeekend && d.todayActive,
    pool: [
      "AI on a {dayName}? Some people go outside. Not judging.",
      "Weekend AI warrior reporting for duty.",
      "{dayName} plans: brunch, AI, existential questions. Classic.",
      "Using {platform} on {dayName}? Your friends are at the beach.",
      "The weekend: when your AI finally gets some quality time with you.",
      "Work-life-AI balance on {dayName}: balance not found.",
      "Happy {dayName}! Your AI is happy to see you too. Probably.",
      "{dayName} vibes: sweatpants, snacks, and sophisticated AI prompts.",
      "Weekend project or weekend rabbit hole? Either way, {platform} is here.",
      "Friends: 'Let's go out!' You: 'I'm having a fascinating chat with {platform}.'",
    ],
  },
  messageBurst: {
    condition: (d) => d.todayMessages >= 30,
    pool: [
      "{msgCount} messages today. That's a whole group chat, but just you and AI.",
      "You've sent {msgCount} messages today. Your thumbs deserve a medal.",
      "{msgCount} messages. At this point, {platform} knows your writing style better than you do.",
      "Chatty day! {msgCount} messages and still going.",
      "{msgCount} prompts fired today. Rate of fire: impressive.",
      "Your message count ({msgCount}) just passed your step count. Priorities.",
      "{msgCount} messages today — each one a tiny masterpiece of curiosity.",
      "The AI has processed {msgCount} of your requests today. Give it a raise.",
      "{msgCount} messages deep. This isn't a chat, it's an epic.",
    ],
  },
  lowUsage: {
    condition: (d) => d.weekMinutes > 0 && d.weekMinutes < 30,
    pool: [
      "Only {weekMin} minutes this week? The AIs miss you.",
      "Casual AI user detected. We respect that.",
      "Touching grass AND using AI? A rare balance.",
      "Your AI subscriptions are feeling neglected.",
      "Low usage week. Saving your best prompts for later?",
      "{weekMin} minutes all week? Either very efficient or very busy.",
      "Minimalist AI usage. Marie Kondo would approve.",
      "The AIs are refreshing their tabs waiting for you.",
      "Quality over quantity? With {weekMin} minutes, it better be quality.",
      "Your AI is like a gym membership: paid for, rarely visited.",
    ],
  },
  firstTime: {
    condition: (d) => d.isFirstDay,
    pool: [
      "Welcome to Aleph Insights! Let's see how your AI habits unfold.",
      "Day one of tracking. The data journey begins.",
      "Your AI usage story starts here. No pressure.",
      "First day! Check back tomorrow for your hourly breakdown.",
      "Welcome! We promise to only mildly judge your AI habits.",
      "And so it begins. Your AI data era.",
    ],
  },
};

const REMARK_PRIORITY = [
  "lateNight", "longSession", "tokenHeavy", "multiPlatform",
  "highSpend", "messageBurst", "weekend", "evening",
  "prediction", "earlyBird", "lowUsage", "firstTime",
];

async function generateRemark(platform) {
  const now = new Date();
  const key = todayKey();
  const usage = await readLocal(key, {});
  const subs = await readLocal("insights_subscriptions", {});
  const usedRemarks = await readLocal("insights_used_remarks", []);

  let totalMonthly = 0;
  for (const p of ["claude", "chatgpt", "gemini"]) {
    totalMonthly += (subs[p]?.price || 0);
  }

  const platforms = ["claude", "chatgpt", "gemini"];
  const activePlatforms = platforms.filter((p) => (usage[p]?.totalSeconds || 0) > 0);
  let maxPlatform = platform || "Claude";
  let maxMinutes = 0;
  for (const p of platforms) {
    const mins = Math.round((usage[p]?.totalSeconds || 0) / 60);
    if (mins > maxMinutes) { maxMinutes = mins; maxPlatform = p; }
  }

  let todayTokens = 0;
  for (const p of platforms) {
    todayTokens += (usage[p]?.tokensIn || 0) + (usage[p]?.tokensOut || 0);
  }

  const weekKeys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    weekKeys.push("usage_" + d.toISOString().slice(0, 10));
  }
  const weekData = await chrome.storage.local.get(weekKeys);
  let weekSeconds = 0;
  let hasAnyPrior = false;
  for (const wk of weekKeys) {
    const day = weekData[wk];
    if (!day) continue;
    for (const p of platforms) weekSeconds += (day[p]?.totalSeconds || 0);
    if (wk !== key) hasAnyPrior = true;
  }
  const weekMinutes = Math.round(weekSeconds / 60);
  const weekHours = Math.round(weekSeconds / 3600 * 10) / 10;
  const dayOfWeek = now.getDay() || 7;
  const projectedWeekHours = dayOfWeek > 0 ? Math.round(weekHours / dayOfWeek * 7 * 10) / 10 : weekHours;
  const projectedMonthHours = Math.round(projectedWeekHours * 4.3 * 10) / 10;

  let todayMessages = 0;
  for (const p of platforms) {
    todayMessages += (usage[p]?.messageCount || 0);
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const ctx = {
    hour: now.getHours(),
    todayActive: activePlatforms.length > 0,
    maxPlatformMinutes: maxMinutes,
    platformCount: activePlatforms.length,
    totalMonthly,
    weekHours: projectedWeekHours,
    weekMinutes,
    todayTokensK: Math.round(todayTokens / 1000),
    isFirstDay: !hasAnyPrior,
    isWeekend: now.getDay() === 0 || now.getDay() === 6,
    todayMessages,
  };

  const vars = {
    platform: ({ claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" })[maxPlatform] || maxPlatform,
    hour: String(now.getHours()),
    minutes: String(maxMinutes),
    hoursRound: String(Math.round(maxMinutes / 60)),
    weekHours: String(projectedWeekHours),
    monthHours: String(projectedMonthHours),
    total: String(totalMonthly),
    coffees: String(Math.round(totalMonthly / 5)),
    weekMin: String(weekMinutes),
    todayTokensK: String(Math.round(todayTokens / 1000)),
    dayName: dayNames[now.getDay()],
    msgCount: String(todayMessages),
    sunHoursAgo: String(Math.max(0, now.getHours() - 18)),
  };

  for (const cat of REMARK_PRIORITY) {
    const entry = REMARKS[cat];
    if (!entry.condition(ctx)) continue;

    let pool = entry.pool.filter((r) => !usedRemarks.includes(r));
    if (pool.length === 0) pool = entry.pool;

    const template = pool[Math.floor(Math.random() * pool.length)];
    let text = template;
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp("\\{" + k + "\\}", "g"), v);
    }

    const updatedUsed = [...usedRemarks, template].slice(-80);
    await writeLocal("insights_used_remarks", updatedUsed);
    await writeLocal("insights_last_remark", { text, category: cat, generatedAt: Date.now() });
    return text;
  }
  return null;
}

// ── Cleanup ──────────────────────────────────────────────
async function cleanupOldUsage() {
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = "usage_" + cutoff.toISOString().slice(0, 10);
  const toRemove = Object.keys(all).filter((k) => k.startsWith("usage_") && k < cutoffStr);
  if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);
}

chrome.runtime.onInstalled?.addListener(() => {
  cleanupOldUsage();
  alephSync.restoreAuth().then(() => alephSync.processRetryQueue()).catch(() => {});
});
chrome.runtime.onStartup?.addListener(() => {
  cleanupOldUsage();
  alephSync.restoreAuth().then(() => alephSync.processRetryQueue()).catch(() => {});
});

// ── Message handlers ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Sync handlers — from popup/settings (not content scripts)
  if (msg.type === "aleph-sync-signin") {
    alephSync.signIn().then(sendResponse);
    return true;
  }
  if (msg.type === "aleph-sync-signout") {
    alephSync.signOut().then(sendResponse);
    return true;
  }
  if (msg.type === "aleph-sync-status") {
    alephSync.getAuthState().then(sendResponse);
    return true;
  }
  if (msg.type === "aleph-sync-now") {
    alephSync.fullMergeAndSync().then(() => sendResponse({ success: true })).catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // Insights summary — allowed from any extension context (popup, dashboard)
  if (msg.type === "insights-get-summary") {
    (async () => {
      const subs = await readLocal("insights_subscriptions", {});
      const key = todayKey();
      const today = await readLocal(key, {});
      const remark = await readLocal("insights_last_remark", null);

      const weekData = {};
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const wk = "usage_" + d.toISOString().slice(0, 10);
        const data = await readLocal(wk, null);
        weekData[wk] = data;
      }

      const prevWeekData = {};
      for (let i = 7; i < 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const wk = "usage_" + d.toISOString().slice(0, 10);
        const data = await readLocal(wk, null);
        prevWeekData[wk] = data;
      }

      const platformUsage = {};
      for (const p of ["claude", "chatgpt", "gemini"]) {
        platformUsage[p] = await readLocal("insights_platform_usage_" + p, null);
      }

      const modelCaps = {};
      for (const p of ["claude", "chatgpt", "gemini"]) {
        modelCaps[p] = await readLocal("insights_model_caps_" + p, null);
      }

      const chatgptModelTs = await readLocal("insights_chatgpt_model_ts", {});

      sendResponse({ subs, today, remark, weekData, prevWeekData, platformUsage, modelCaps, chatgptModelTs });
    })();
    return true;
  }

  if (!sender.tab) return;
  const tabId = sender.tab.id;

  // Badge (existing)
  if (msg.type === "badge") {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#7c83ff", tabId });
  }

  if (msg.type === "disabled") {
    chrome.action.setBadgeText({ text: "OFF", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#666", tabId });
  }

  // Insights: time tracking
  if (msg.type === "insights-time") {
    (async () => {
      const key = todayKey();
      const usage = await readLocal(key, {});
      const p = msg.platform;
      if (!usage[p]) usage[p] = emptyPlatformDay();
      usage[p].totalSeconds += msg.seconds;
      const h = String(msg.hour);
      usage[p].hours[h] = (usage[p].hours[h] || 0) + msg.seconds;
      await writeLocal(key, usage);

      const remark = await readLocal("insights_last_remark", null);
      if (!remark || Date.now() - remark.generatedAt > 1800000) {
        await generateRemark(p);
      }
    })();
  }

  // Insights: message + tokens + per-model timestamps (for ChatGPT rolling window)
  if (msg.type === "insights-message") {
    (async () => {
      const key = todayKey();
      const usage = await readLocal(key, {});
      const p = msg.platform;
      if (!usage[p]) usage[p] = emptyPlatformDay();
      usage[p].messageCount++;
      if (msg.role === "user") usage[p].tokensIn += (msg.estimatedTokens || 0);
      else if (msg.role === "assistant") usage[p].tokensOut += (msg.estimatedTokens || 0);

      // Store per-model timestamps for rolling-window tracking (ChatGPT)
      if (p === "chatgpt" && msg.model && msg.role === "user") {
        const tsKey = "insights_chatgpt_model_ts";
        const modelTs = await readLocal(tsKey, {});
        const m = msg.model;
        if (!modelTs[m]) modelTs[m] = [];
        modelTs[m].push(msg.timestamp || Date.now());
        // Prune timestamps older than 24 hours
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const k of Object.keys(modelTs)) {
          modelTs[k] = modelTs[k].filter((t) => t > cutoff);
          if (modelTs[k].length === 0) delete modelTs[k];
        }
        await writeLocal(tsKey, modelTs);
      }
      await writeLocal(key, usage);
    })();
  }

  // Insights: subscription detection
  if (msg.type === "insights-subscription") {
    (async () => {
      const subs = await readLocal("insights_subscriptions", {});
      if (subs[msg.platform]?.manualOverride) return;
      subs[msg.platform] = {
        plan: msg.plan,
        price: msg.price,
        label: msg.label,
        model: msg.model,
        detectedAt: Date.now(),
        manualOverride: false,
      };
      await writeLocal("insights_subscriptions", subs);
    })();
  }

  // Insights: real usage data (Claude's /api/organizations/{orgId}/usage)
  if (msg.type === "insights-usage") {
    (async () => {
      await writeLocal("insights_platform_usage_" + msg.platform, {
        ...msg.usage,
        fetchedAt: Date.now(),
      });
    })();
  }

  // Insights: model capabilities
  if (msg.type === "insights-model-caps") {
    (async () => {
      await writeLocal("insights_model_caps_" + msg.platform, {
        ...msg.caps,
        fetchedAt: Date.now(),
      });
    })();
  }

  // insights-get-summary handled above the sender.tab guard
});

// Toggle command (existing)
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-aleph" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "toggle" });
  }
});
