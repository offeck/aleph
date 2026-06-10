# Launch Posts — ready-to-paste copy per channel

Store link: https://chromewebstore.google.com/detail/jpicfbmjogpihahcmephbnibnjkfkfia
Repo link: https://github.com/offeck/aleph
Hero image for posts: `store-assets/final/01-before-after.png` (attach it everywhere images are allowed).

## Sequencing — do not skip the gates

1. **Gate 1 — listing live.** Post nothing until the dashboard shows the new
   screenshots + copy (after the pending CWS review clears). Traffic to the old
   listing (one watermarked screenshot, 3.0★) converts badly and first
   impressions don't repeat.
2. **Gate 2 — seed honest reviews.** Before any big post, ask a handful of real
   users (friends, classmates, group members who already use it) to rate it —
   honestly, unincentivized (CWS bans paid/quid-pro-quo reviews). Target: ≥5
   reviews, ≥4.5★ average, so the social proof exists when traffic lands.
3. **Then stagger posts over ~2 weeks** (one channel every 2-3 days), reply to
   every comment within hours, and watch installs-per-day in the CWS dashboard
   to see which channel works. Double down there.

---

## 1. Hebrew Facebook / Telegram groups (highest density of the exact pain)

Target groups: the big Israeli AI/tech Facebook groups and Telegram channels
you're already in. Post in Hebrew, lead with the image, keep it short:

> מכירים את זה שאתם שואלים את Claude או ChatGPT משהו בעברית, והתשובה יוצאת...
> הפוכה? נקודות בתחילת שורה, רשימות ממוספרות שבורות, נוסחאות שמתערבבות עם
> הטקסט?
>
> נמאס לי, אז בניתי תוסף כרום שמתקן את זה אוטומטית — בעברית ובערבית, ב-Claude,
> ChatGPT ו-Gemini. הוא מזהה כיווניות לכל פסקה בנפרד (לא הופך הכל בכוח), שומר
> על נוסחאות וקוד קריאים, ועובד גם בזמן שהתשובה נכתבת.
>
> בונוס: לוח אחד שמראה כמה זמן/הודעות/טוקנים שרפתם בכל פלטפורמה, כולל מדי
> המכסה של Claude (חלון 5 שעות ושבועי).
>
> חינם, קוד פתוח, בלי איסוף נתונים: [קישור לחנות]
> אשמח לפידבק — ואם זה עוזר לכם, דירוג בחנות עוזר לי מאוד 🙏

(תמונה מצורפת: before/after)

## 2. Reddit — r/ClaudeAI

**Title:** I built a free, open-source extension that fixes Hebrew/Arabic text direction on Claude (works on ChatGPT & Gemini too)

**Body:**

> If you ever chat with Claude in Hebrew, Arabic, Persian, or Urdu you know the
> pain: paragraphs hug the wrong side, periods jump to the start of lines,
> numbered lists fall apart, and math collides with the text.
>
> I built Aleph to fix this properly: it detects direction per element from the
> actual characters (nothing is force-flipped), isolates KaTeX/code so they stay
> readable inside RTL text, and keeps working while the response streams.
>
> It also grew a usage dashboard I now can't live without: Claude's 5-hour and
> weekly rate-limit meters, time/messages/tokens per platform, and combined
> subscription spend — across Claude, ChatGPT, and Gemini.
>
> Free, MIT-licensed, everything stays on your device (no telemetry, chats are
> never read off-page). Chrome Web Store: [link] — Source: [repo link]
>
> Would love feedback, especially from RTL users on edge cases I haven't hit.

(Attach the before/after image. Variants: r/ChatGPT — swap the first line's
platform emphasis; r/GoogleGemini likewise. Read each sub's self-promo rules
the same day you post; some require a comment ratio or specific flair.)

## 3. Show HN

**Title:** Show HN: Aleph – fixing Hebrew/Arabic text in ChatGPT, Claude and Gemini

**Body:**

> AI chat platforms render mixed RTL/LTR text badly: the Unicode BiDi algorithm
> sees a line that starts with Hebrew but contains English tokens, set notation,
> or math, and reorders it into soup. Each platform breaks differently, and
> none of them set direction per block.
>
> Aleph is a Chrome extension that fixes this with per-character script
> detection: it walks text nodes (skipping katex/mjx/code subtrees), marks
> RTL-containing blocks with a data attribute, and lets CSS apply
> `direction: rtl; unicode-bidi: plaintext` per element — so Hebrew paragraphs
> go RTL while English ones stay LTR in the same response. A
> MutationObserver with a quiet-window debounce and budgeted scan slices keeps
> it working during streaming without jank; KaTeX/MathJax and code blocks are
> isolated to stay LTR.
>
> It also unifies styling across the three platforms (themes, fonts, chat
> width, a focus mode that hides upsell banners) and tracks usage locally —
> including Claude's 5-hour/weekly rate-limit meters and per-platform
> time/token estimates, since I kept blowing through limits shared with the
> CLI tools.
>
> Everything is local-first: no telemetry, conversation text never leaves the
> page; optional Google sign-in syncs only daily aggregate counters and
> settings (Firestore rules are versioned in the repo and emulator-tested).
> MIT licensed.
>
> Store: [link] — Source: https://github.com/offeck/aleph
>
> Happy to answer questions about BiDi edge cases — they get surprisingly deep
> (bidi-neutral characters around bold markers were the worst).

(Post on a weekday morning US time. Stay in the thread all day.)

## 4. Arabic AI communities (Telegram/Facebook/X)

> هل تدردش مع ChatGPT أو Claude بالعربية وتظهر الإجابة مكسورة؟ فقرات ملتصقة
> بالجهة الخطأ، علامات ترقيم في أول السطر، قوائم مبعثرة؟
>
> بنيت إضافة كروم تصلح ذلك تلقائيًا — للعربية والفارسية والأردية — في Claude
> وChatGPT وGemini. تكتشف الاتجاه لكل فقرة من الأحرف نفسها، تحافظ على
> المعادلات والأكواد مقروءة، وتعمل أثناء كتابة الإجابة مباشرة.
>
> مجانية ومفتوحة المصدر وبدون جمع بيانات: [رابط المتجر]
> رأيكم يهمني — وتقييمكم في المتجر يساعد كثيرًا 🙏

## 5. X/Twitter thread (EN; post a HE version too)

> 1/ Hebrew and Arabic text in AI chats is broken. Not "slightly off" — broken:
> [before/after image]
>
> 2/ The Unicode BiDi algorithm can't guess paragraph direction when Hebrew
> mixes with English tokens and math. ChatGPT, Claude, and Gemini all get it
> wrong, each differently.
>
> 3/ So I built Aleph: per-character direction detection, math/code isolation,
> works mid-stream. Plus one dashboard for your usage and rate-limits across
> all three platforms.
>
> 4/ Free, open source, zero telemetry. [store link]

## 6. Product Hunt (after the above rounds prove the pitch)

- **Tagline (≤60):** Fix broken RTL text in AI chats — and track your usage
- **First comment (maker):** the Show HN body, shortened, with the personal
  story up front (you built it because your own calculus chats were unreadable).

---

## Asset backlog (nice-to-have, in order of impact)

1. **Before/after GIF** (3-4s toggle loop) — outperforms the static image in
   feeds; record with the toggle hotkey + any screen recorder, or ask Claude to
   automate it with the capture rig in `store-assets/`.
2. README hero — done (top of README).
3. One-page landing on GitHub Pages targeting "ChatGPT Hebrew fix" /
   "עברית ChatGPT" queries, linking to the store.
4. Slot-5 store screenshot: themed conversation (Tokyo Night or Dracula).

---

## Post ideas backlog (after launch round 1)

### Recurring series (cheap to produce, keep the channels warm)

- **Before/after of the week** — one broken-vs-fixed shot per platform per
  language (the Gemini and ChatGPT versions haven't been shown yet; Arabic
  versions reach the larger audience). Format is proven; content rotates.
- **"Fix of the week" changelogs** — every time a platform DOM change breaks
  detection and you ship a fix within days, post it in the HE/AR groups. It
  reads as "actively maintained," which is the #1 trust signal against the
  abandoned competitors.
- **15-second feature clips** — one short clip per feature (toggle hotkey,
  theme switch, focus mode wiping the upsell banners, quota meter filling).
  X/Reddit native video; reuse on the store listing later as the promo video.

### One-off content pieces (each can carry a Reddit/HN/newsletter cycle)

- **"I tracked every minute I spent with AI for a month"** — your own
  dashboard data as a story: peak hours, spend vs. usage, Claude-vs-ChatGPT
  split. Personal data = zero privacy issues, very shareable, and it
  advertises the insights wedge to non-RTL users.
- **"Your Claude Code CLI and claude.ai share the same limits — here's where
  your quota actually goes"** — the meters angle, timed to the next big
  rate-limit discourse wave on r/ClaudeAI (recurs roughly monthly).
- **"I tested 7 RTL extensions on the same Hebrew conversation"** — turn
  docs/COMPETITORS.md into an honest public comparison with screenshots.
  Be scrupulously fair (praise Chat-Math RTL Fix's niche, RTL Responder's
  Claude polish); the multi-platform + math story wins on its own.
- **BiDi engineering deep-dive** — "Why mixed Hebrew/English breaks in
  streaming AI chats (and the bidi-neutral asterisk problem)" on dev.to /
  blog; this is the evergreen technical link HN and newsletters pick up.
- **Exam-season student posts** — Hebrew math+AI study workflow ("חדו"א עם
  Claude בלי הבלגן") in Israeli university CS/math groups, timed to moadei א/ב.
  Students with Hebrew calculus chats are the exact persona of the hero shot.

### Reactive (set up once, low effort, compounding)

- **Saved searches / alerts** for "Hebrew ChatGPT", "עברית הפוך ChatGPT",
  "العربية ChatGPT مقلوب", "RTL Claude" on Reddit/X — answer helpfully with a
  screenshot when people complain; the complaint threads ARE the audience.
- **Pitch Hebrew tech media** (Geektime and friends): the story is "an
  open-source fix for Hebrew AI chats from a local dev" — they cover this
  genre regularly.
- **GitHub as a channel**: label 3-4 `good first issue`s (new theme presets,
  font additions are perfect), so the repo can ride open-source discovery;
  stars feed back into credibility everywhere else.

### Hold for later (needs scale or extra care)

- **Aggregate peak-hours data story** ("when does Israel talk to AI?") — only
  meaningful with hundreds of synced users, and publishing aggregates of user
  data needs a privacy-policy disclosure + opt-out before doing it. Flag for
  ~6 months out; the per-user version (your own data) covers the angle until
  then.
- **Store promo video** — stitch the 15-second clips once they exist.
