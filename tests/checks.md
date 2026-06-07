# Regression Check Implementations

Run each check via `mcp__claude-in-chrome__javascript_tool`. Each returns `PASS:`, `FAIL:`, or `SKIP:` with details.

## Runner notes

Run checks only after the conversation has rendered — wait ~3-5s after page load before running any check. The extension runs at `document_idle` and marks elements asynchronously (120ms-debounced MutationObserver + 3s interval fallback), so a check run too early sees an unsettled DOM.

Zero-element results are suspect: if a check FAILs purely on a zero-element count, or returns the "page not settled" SKIP, wait 3s and re-run it once before recording the result. Other SKIPs never need a re-run.

## `rtl-direction`

```javascript
(() => {
  // KEEP IN SYNC with RTL_SCRIPT_LETTER_RE in src/shared/rtl.ts.
  const RTL_SCRIPT_LETTER_RE = /(?=[\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/u;
  // Union of SELECTORS[platform].text in src/shared/selectors.ts — the exact
  // elements the extension scans with hasRTL() and marks.
  const TEXT_SEL = [
    ".font-claude-response-body", ".standard-markdown p", ".standard-markdown li", ".standard-markdown h1", ".standard-markdown h2", ".standard-markdown h3", ".standard-markdown h4", ".standard-markdown blockquote", ".progressive-markdown p", ".progressive-markdown li", ".progressive-markdown h1", ".progressive-markdown h2", ".progressive-markdown h3", ".progressive-markdown h4", ".font-claude-response p", ".font-claude-response li", ".whitespace-pre-wrap",
    ".markdown p", ".markdown li", ".markdown h1", ".markdown h2", ".markdown h3", ".markdown h4", ".markdown blockquote", ".prose p", ".prose li", "[data-message-author-role='assistant'] p", "[data-message-author-role='assistant'] li",
    ".response-content p", ".response-content li", ".response-content h1", ".response-content h2", ".response-content h3", ".response-content h4", ".response-content blockquote", ".model-response-text p", ".model-response-text li", "message-content p", "message-content li",
  ].join(", ");
  // Wrapper presence only distinguishes "not rendered yet" from "no RTL content".
  // KEEP IN SYNC with MESSAGE_WRAPPER_SELECTOR_UNION in src/shared/selectors.ts.
  const WRAPPER_SEL = "[data-testid='chat-message'], .font-claude-response, [data-testid='user-message'], [data-testid^='conversation-turn'], .group\\/conversation-turn, model-response, .conversation-turn, .query-content, message-content";

  const marked = document.querySelectorAll('[data-aleph-rtl]');
  if (marked.length > 0) {
    const issues = [];
    marked.forEach((el, i) => {
      const dir = getComputedStyle(el).direction;
      if (dir !== 'rtl') issues.push('Element ' + i + ' has direction: ' + dir + ' instead of rtl');
    });
    return issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: ' + marked.length + ' RTL elements found';
  }
  if (document.querySelectorAll(WRAPPER_SEL).length === 0) return 'SKIP: no message containers found (page not settled/loaded)';
  // Mirror hasRTL(): ignore RTL text inside katex/mjx-container/code/pre subtrees.
  const hasRTLText = Array.from(document.querySelectorAll(TEXT_SEL)).some((el) => {
    if (!RTL_SCRIPT_LETTER_RE.test(el.textContent || '')) return false;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.katex, mjx-container, code, pre').forEach((n) => n.remove());
    return RTL_SCRIPT_LETTER_RE.test(clone.textContent || '');
  });
  if (!hasRTLText) return 'SKIP: no RTL-script text in conversation';
  return 'FAIL: RTL text present in message text elements but 0 elements marked [data-aleph-rtl]';
})()
```

## `math-ltr-isolation`

```javascript
(() => {
  const mathEls = document.querySelectorAll('.katex, mjx-container');
  let issues = [];
  mathEls.forEach((el, i) => {
    const dir = getComputedStyle(el).direction;
    if (dir !== 'ltr') issues.push(`Math element ${i} (${el.tagName}) has direction: ${dir}`);
  });
  return mathEls.length === 0 ? 'SKIP: No math elements' :
    issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: ' + mathEls.length + ' math elements isolated LTR';
})()
```

## `no-console-errors`

Use `mcp__claude-in-chrome__read_console_messages` with pattern `Aleph|aleph` and check for error-level messages. Do **not** use `javascript_tool` for this check.

## `latex-rendered`

```javascript
(() => {
  const katex = document.querySelectorAll('.katex');
  const errors = document.querySelectorAll('.katex-error');
  if (katex.length === 0) return 'SKIP: No katex elements';
  if (errors.length > 0) return 'FAIL: ' + errors.length + ' katex-error elements found';
  return 'PASS: ' + katex.length + ' katex elements rendered';
})()
```

## `theme-applied`

```javascript
(() => {
  const theme = document.documentElement.getAttribute('data-aleph-theme');
  if (!theme) return 'SKIP: No theme set';
  const style = getComputedStyle(document.documentElement);
  const vars = ['--aleph-bg', '--aleph-text', '--aleph-accent', '--aleph-border'];
  const missing = vars.filter(v => !style.getPropertyValue(v));
  return missing.length ? 'FAIL: Missing CSS vars: ' + missing.join(', ') : 'PASS: Theme ' + theme + ' applied';
})()
```

## `focus-hidden`

```javascript
(() => {
  const hidden = document.querySelectorAll('[data-aleph-hidden]');
  if (hidden.length === 0) return 'SKIP: No hidden elements';
  let issues = [];
  hidden.forEach((el, i) => {
    if (getComputedStyle(el).display !== 'none') issues.push(`Element ${i} not display:none`);
  });
  return issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: ' + hidden.length + ' elements hidden';
})()
```

## `streaming-attrs`

```javascript
(() => {
  const html = document.documentElement;
  const enabled = html.hasAttribute('data-aleph-stream-enabled');
  const anim = html.getAttribute('data-aleph-stream-anim');
  if (!enabled) return 'SKIP: Streaming not enabled';
  if (!anim) return 'FAIL: data-aleph-stream-anim missing';
  return 'PASS: Streaming enabled with animation: ' + anim;
})()
```

## `composer-bidi-performance`

Async check, takes ~12s, **requires a visible tab** (hidden tabs throttle timers and never fire rAF, so the cadence stalls and a loop couldn't manifest anyway). Detects the composer write→revert feedback loop (c7bb26f regression) and verifies composer RTL behavior survives. Warmup exists because claude.ai/new has a known one-time ~1.5s first-input lazy-init burst that is NOT extension cost — never measure the first keystrokes after page load. The loop detector runs cross-world: a `javascript_tool` rAF patch can't see the content script's isolated world, but the loop's host re-renders are DOM mutations visible from any world, so the silence window counts composer-subtree mutation records — and fails only on the *sustained* signature (churn in both 1s halves), not on incidental site/extension bursts. On Gemini, `execCommand` may not reach Quill — the check SKIPs if typed text doesn't land (drive the Quill API manually per Testing Notes).

```javascript
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!document.documentElement.hasAttribute('data-aleph-bidi-enabled')) return 'SKIP: BiDi not enabled';
  const ed = document.querySelector('.ProseMirror, #prompt-textarea, .ql-editor');
  if (!ed) return 'SKIP: no composer found (page not settled?)';
  const type = (t) => { ed.focus(); document.execCommand('insertText', false, t); };
  const clearAll = () => { ed.focus(); document.execCommand('selectAll'); document.execCommand('delete'); };

  // Warmup: absorb the platform's first-input lazy-init burst, then clear.
  type('abc');
  await sleep(2000);
  clearAll();
  await sleep(500);

  // Typing window (~5s): Hebrew, char by char.
  const typingTasks = [];
  const obs = new PerformanceObserver((l) => typingTasks.push(...l.getEntries()));
  obs.observe({ type: 'longtask' });
  const hebrew = 'שלום עולם זהו מבחן ביצועים של העורך'.split('');
  for (const ch of hebrew) { type(ch); await sleep(120); }
  obs.disconnect();
  if (!(ed.textContent || '').includes('שלום')) { clearAll(); return 'SKIP: execCommand typing did not reach the editor (Gemini: use the Quill API)'; }

  // Behavior: the Hebrew block must be RTL and right-aligned.
  const block = Array.from(ed.querySelectorAll(':scope > p, :scope > div, :scope > li'))
    .find((b) => (b.textContent || '').includes('שלום')) || ed;
  const cs = getComputedStyle(block);
  const behaviorOk = cs.direction === 'rtl';
  const alignOk = cs.textAlign === 'right' || cs.textAlign === 'start';

  // Silence window: 2s grace, then 2s measured in two 1s halves. The loop
  // signature is SUSTAINED churn (a live write→revert loop produces hundreds
  // of records per second in every half); an incidental burst from the site
  // or another extension lands in one half and is tolerated.
  await sleep(2000);
  const silenceTasks = [];
  const obs2 = new PerformanceObserver((l) => silenceTasks.push(...l.getEntries()));
  obs2.observe({ type: 'longtask' });
  const mutTimes = [];
  const silenceStart = performance.now();
  const mo = new MutationObserver((recs) => { recs.forEach(() => mutTimes.push(performance.now() - silenceStart)); });
  mo.observe(ed, { childList: true, subtree: true, attributes: true, characterData: true });
  await sleep(2000);
  mo.disconnect();
  obs2.disconnect();
  clearAll();

  const issues = [];
  const halfA = mutTimes.filter((t) => t < 1000).length;
  const halfB = mutTimes.filter((t) => t >= 1000).length;
  if ((halfA > 25 && halfB > 25) || mutTimes.length > 200) {
    issues.push('sustained composer churn with no input: ' + halfA + '+' + halfB + ' mutation records across both silence halves (feedback loop)');
  }
  const slowSilence = silenceTasks.filter((t) => t.duration >= 150);
  if (silenceTasks.length >= 2 || slowSilence.length) {
    issues.push(silenceTasks.length + ' longtasks during silence window' + (slowSilence.length ? ' (max ' + Math.round(Math.max(...slowSilence.map((t) => t.duration))) + 'ms)' : ''));
  }
  const slow = typingTasks.filter((t) => t.duration > 150);
  if (typingTasks.length > 3) issues.push(typingTasks.length + ' longtasks while typing');
  if (slow.length) issues.push('longtask of ' + Math.round(Math.max(...slow.map((t) => t.duration))) + 'ms while typing');
  if (!behaviorOk) issues.push('Hebrew composer block has direction: ' + cs.direction + ' instead of rtl');
  if (behaviorOk && !alignOk) issues.push('Hebrew composer block has text-align: ' + cs.textAlign);
  return issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: composer RTL ok, no loop (mutations=' + mutations + ', typing longtasks=' + typingTasks.length + ')';
})()
```

## `selectors-match`

```javascript
(() => {
  // KEEP IN SYNC with RTL_SCRIPT_LETTER_RE in src/shared/rtl.ts.
  const RTL_SCRIPT_LETTER_RE = /(?=[\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/u;
  // Union of SELECTORS[platform].text in src/shared/selectors.ts — the exact
  // elements the extension scans with hasRTL() and marks.
  const TEXT_SEL = [
    ".font-claude-response-body", ".standard-markdown p", ".standard-markdown li", ".standard-markdown h1", ".standard-markdown h2", ".standard-markdown h3", ".standard-markdown h4", ".standard-markdown blockquote", ".progressive-markdown p", ".progressive-markdown li", ".progressive-markdown h1", ".progressive-markdown h2", ".progressive-markdown h3", ".progressive-markdown h4", ".font-claude-response p", ".font-claude-response li", ".whitespace-pre-wrap",
    ".markdown p", ".markdown li", ".markdown h1", ".markdown h2", ".markdown h3", ".markdown h4", ".markdown blockquote", ".prose p", ".prose li", "[data-message-author-role='assistant'] p", "[data-message-author-role='assistant'] li",
    ".response-content p", ".response-content li", ".response-content h1", ".response-content h2", ".response-content h3", ".response-content h4", ".response-content blockquote", ".model-response-text p", ".model-response-text li", "message-content p", "message-content li",
  ].join(", ");

  const issues = [];
  if (document.querySelectorAll('[data-aleph-platform]').length === 0) issues.push('platform selector found 0 elements');
  // Mirror hasRTL(): ignore RTL text inside katex/mjx-container/code/pre subtrees.
  const hasRTLText = Array.from(document.querySelectorAll(TEXT_SEL)).some((el) => {
    if (!RTL_SCRIPT_LETTER_RE.test(el.textContent || '')) return false;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.katex, mjx-container, code, pre').forEach((n) => n.remove());
    return RTL_SCRIPT_LETTER_RE.test(clone.textContent || '');
  });
  if (hasRTLText && document.querySelectorAll('[data-aleph-rtl]').length === 0) {
    issues.push('rtl selector found 0 elements (RTL text present)');
  }
  const theme = document.documentElement.getAttribute('data-aleph-theme');
  if (theme && document.querySelectorAll('[data-aleph-theme]').length === 0) issues.push('theme selector found 0 elements');
  return issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: Required selectors match';
})()
```
