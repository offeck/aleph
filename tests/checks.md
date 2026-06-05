# Regression Check Implementations

Run each check via `mcp__claude-in-chrome__javascript_tool`. Each returns `PASS:`, `FAIL:`, or `SKIP:` with details.

## Runner notes

Run checks only after the conversation has rendered — wait ~3-5s after page load before running any check. The extension runs at `document_idle` and marks elements asynchronously (120ms-debounced MutationObserver + 3s interval fallback), so a check run too early sees an unsettled DOM.

Zero-element results are suspect: if a check FAILs purely on a zero-element count, or returns the "page not settled" SKIP, wait 3s and re-run it once before recording the result. Other SKIPs never need a re-run.

## `rtl-direction`

```javascript
(() => {
  // KEEP IN SYNC with RTL_SCRIPT_LETTER_RE in content.js / insights-tracker.js.
  const RTL_SCRIPT_LETTER_RE = /(?=[\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/u;
  // Union of SELECTORS[platform].text in content.js — the exact elements the
  // extension scans with hasRTL() and marks. KEEP IN SYNC with content.js.
  const TEXT_SEL = [
    ".font-claude-response-body", ".standard-markdown p", ".standard-markdown li", ".standard-markdown h1", ".standard-markdown h2", ".standard-markdown h3", ".standard-markdown h4", ".standard-markdown blockquote", ".progressive-markdown p", ".progressive-markdown li", ".progressive-markdown h1", ".progressive-markdown h2", ".progressive-markdown h3", ".progressive-markdown h4", ".font-claude-response p", ".font-claude-response li", ".whitespace-pre-wrap",
    ".markdown p", ".markdown li", ".markdown h1", ".markdown h2", ".markdown h3", ".markdown h4", ".markdown blockquote", ".prose p", ".prose li", "[data-message-author-role='assistant'] p", "[data-message-author-role='assistant'] li",
    ".response-content p", ".response-content li", ".response-content h1", ".response-content h2", ".response-content h3", ".response-content h4", ".response-content blockquote", ".model-response-text p", ".model-response-text li", "message-content p", "message-content li",
  ].join(", ");
  // Wrapper presence only distinguishes "not rendered yet" from "no RTL content".
  // KEEP IN SYNC with messageWrapper (content.js) / MSG_WRAPPER (insights-tracker.js).
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

## `selectors-match`

```javascript
(() => {
  // KEEP IN SYNC with RTL_SCRIPT_LETTER_RE in content.js / insights-tracker.js.
  const RTL_SCRIPT_LETTER_RE = /(?=[\p{Script=Hebrew}\p{Script=Arabic}])\p{L}/u;
  // Union of SELECTORS[platform].text in content.js — the exact elements the
  // extension scans with hasRTL() and marks. KEEP IN SYNC with content.js.
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
