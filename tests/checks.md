# Regression Check Implementations

Run each check via `mcp__claude-in-chrome__javascript_tool`. Each returns `PASS:`, `FAIL:`, or `SKIP:` with details.

## `rtl-direction`

```javascript
(() => {
  const msgs = document.querySelectorAll('[data-aleph-rtl]');
  let issues = [];
  if (msgs.length === 0) issues.push('No elements with data-aleph-rtl found');
  msgs.forEach((el, i) => {
    const dir = getComputedStyle(el).direction;
    if (dir !== 'rtl') issues.push(`Element ${i} has direction: ${dir} instead of rtl`);
  });
  return issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: ' + msgs.length + ' RTL elements found';
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
  const checks = [
    ['[data-aleph-platform]', 'platform'],
    ['[data-aleph-rtl]', 'rtl'],
    ['[data-aleph-theme]', 'theme'],
  ];
  let issues = [];
  checks.forEach(([sel, name]) => {
    if (document.querySelectorAll(sel).length === 0) issues.push(name + ' selector found 0 elements');
  });
  return issues.length ? 'FAIL: ' + issues.join('; ') : 'PASS: All selectors match';
})()
```
