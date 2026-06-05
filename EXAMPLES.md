# Examples

Real-world Aleph examples demonstrating the seven Development Guidelines. Each shows what goes wrong and what should happen instead.

---

## 1. Restate Before Acting

**User Request:** "Fix the Hebrew text on ChatGPT"

### Bad — What Goes Wrong

```javascript
// Immediately rewrites hasRTL() to add ChatGPT-specific detection
function hasRTL(el) {
  if (!el) return false;
  // Special handling for ChatGPT's markdown container
  if (PLATFORM === "chatgpt" && el.closest(".markdown")) {
    return RTL_SCRIPT_LETTER_RE.test(el.textContent);
  }
  for (const c of el.childNodes) {
    // ... rest of function
  }
}
```

**Problems:**
- Assumed "fix" means BiDi detection is broken — could be font rendering, layout direction, or LaTeX
- Assumed it's scoped to ChatGPT only — might affect all platforms
- Started coding before understanding the actual symptom

### Good — What Should Happen

```
Before implementing, I need to clarify:

1. **What's broken?** Is Hebrew text:
   - Not detected as RTL? (BiDi detection — hasRTL() in content.js)
   - Detected but displayed wrong? (CSS direction — content.css)
   - Missing in LaTeX/math blocks? (patchLatex() exclusion)
   - Rendered in wrong font? (font loading)

2. **Where exactly?** In:
   - Chat responses only?
   - The editor/input area?
   - Code blocks? (those are intentionally excluded)

3. **Scope:** ChatGPT only, or are you seeing this on Claude/Gemini too?

Can you share a screenshot or describe what you're seeing?
```

---

## 2. Search Before Building

**User Request:** "Hide the new promo banner Gemini started showing"

### Bad — What Goes Wrong

```javascript
// Creates a brand new function with its own DOM logic
function hideGeminiPromo() {
  const banners = document.querySelectorAll('.promo-banner, [data-promo]');
  banners.forEach(el => {
    el.style.display = 'none';
    el.style.setProperty('display', 'none', 'important');
  });
}

// Calls it from patchAll()
function patchAll() {
  // ...existing patches...
  if (PLATFORM === "gemini") hideGeminiPromo();
}
```

**Problems:**
- Reinvented focus mode's element-hiding logic from scratch
- Ignored that `applyFocusMode()` already processes `SELECTORS[platform].focusHide` categories
- Added a new call in `patchAll()` when the infrastructure already handles this
- Used inline `style.display` instead of the `data-aleph-hidden` attribute pattern

### Good — What Should Happen

```javascript
// Just add the selector to the existing structure (content.js, SELECTORS.gemini)
gemini: {
  // ...existing selectors...
  focusHide: {
    upgrade: [/* existing */],
    chips: [/* existing */],
    promos: [".promo-banner", "[data-promo]"],  // <-- add here
  },
}
```

The existing `applyFocusMode()` already iterates over `focusHide` categories, queries each selector, and sets `data-aleph-hidden="true"`. The existing CSS rule `[data-aleph-hidden] { display: none !important }` handles the rest. Zero new code needed.

---

## 3. Generalized Solutions Only

**User Request:** "BiDi detection isn't working inside `<details>` elements on Claude"

### Bad — What Goes Wrong

```javascript
function hasRTL(el) {
  if (!el) return false;
  for (const c of el.childNodes) {
    if (c.nodeType === 3 && RTL_SCRIPT_LETTER_RE.test(c.textContent)) return true;
    if (c.nodeType === 1) {
      const tag = c.tagName?.toLowerCase();
      if (c.classList?.contains("katex") || tag === "mjx-container" ||
          tag === "code" || tag === "pre") continue;
      // Special case: expand <details> elements before checking
      if (tag === "details" && !c.open) {
        c.open = true;
        const result = hasRTL(c);
        c.open = false;
        return result;
      }
      if (hasRTL(c)) return true;
    }
  }
  return false;
}
```

**Problems:**
- Monkey-patched `hasRTL()` for one specific element type
- The real question: why isn't `<details>` being reached by `hasRTL()` in the first place?
- Mutating DOM state (`c.open = true`) in a detection function is a side effect

### Good — What Should Happen

```
The hasRTL() function already walks ALL child nodes recursively — it only
skips katex, mjx-container, code, and pre. So <details> children should
already be traversed.

The actual problem: <details> elements aren't being queried at all. They're
not matched by any selector in SELECTORS.claude.text:

  text: [".font-claude-response-body", ".standard-markdown p",
         ".standard-markdown li", ".standard-markdown h1", ...]

The fix is to add ".standard-markdown details" (or a broader selector that
catches any new semantic elements) to SELECTORS.claude.text.

But wait — do ChatGPT and Gemini also render <details>? If so, their text
selectors need the same addition. Let me check all three platforms.
```

The fix addresses the root cause (missing selector) rather than patching the detection function, and checks whether the same gap exists on other platforms.

---

## 4. Simplicity First

**User Request:** "Add a new Gruvbox theme"

### Bad — What Goes Wrong

```javascript
class ThemeBuilder {
  constructor(base) {
    this.colors = { ...base };
  }

  darken(prop, amount) {
    // 30 lines of color manipulation
  }

  lighten(prop, amount) {
    // 30 lines of color manipulation
  }

  withContrast(ratio) {
    // WCAG contrast calculation
  }

  validate() {
    const required = ['bg', 'bgSecondary', 'text', 'accent'];
    for (const key of required) {
      if (!this.colors[key]) throw new Error(`Missing: ${key}`);
    }
    // More validation...
  }

  build() {
    this.validate();
    return Object.freeze(this.colors);
  }
}

const THEMES = {
  // ... existing themes ...
  gruvbox: new ThemeBuilder({
    bg: "#282828", text: "#ebdbb2"
  }).darken('bgSecondary', 0.1).lighten('accent', 0.2).build(),
};
```

**Problems:**
- Created an entire `ThemeBuilder` class for adding one theme
- All 10 existing themes are plain objects with explicit hex values — this breaks the pattern
- Color manipulation, validation, and `Object.freeze` are all speculative features
- More code to maintain, more code to break

### Good — What Should Happen

```javascript
const THEMES = {
  // ... existing themes ...
  gruvbox: {
    bg: "#282828", bgSecondary: "#3c3836", bgTertiary: "#1d2021",
    text: "#ebdbb2", textMuted: "#a89984", accent: "#fe8019",
    border: "#504945", codeBg: "#1d2021", codeBorder: "#3c3836", inputBg: "#32302f",
  },
};
```

One object, 10 properties, matching every other theme exactly. Then add the swatch in `popup.html` and `THEME_NAMES` in `popup.js`.

---

## 5. Surgical Changes

**User Request:** "The ChatGPT upgrade button selector broke — it's not hiding anymore"

### Bad — What Goes Wrong

```diff
  chatgpt: {
-   text: [
-     ".markdown p", ".markdown li",
-     ".markdown h1", ".markdown h2", ".markdown h3",
-   ],
+   // Response text selectors
+   text: [
+     ".markdown p",
+     ".markdown li",
+     ".markdown h1",
+     ".markdown h2",
+     ".markdown h3",
+   ],
    editor: [
      "#prompt-textarea",
    ],
-   // ...
+   // Math rendering selectors
    math: [".katex", ".katex-display"],
    focusHide: {
-     upgrade: [".juice-container button[data-testid='upgrade']"],
+     upgrade: [
+       ".juice-container button[data-testid='upgrade']",
+       "button[data-testid='upgrade-cta']",
+     ],
-     chips: [".stretch.mx-2"],
+     // Suggestion chip selectors
+     chips: [
+       ".stretch.mx-2",
+     ],
      promos: [],
    },
  },
```

**Problems:**
- Reformatted the entire `text` array (one item per line)
- Added comments to `text`, `math`, and `chips` that weren't there before
- Changed formatting of `chips` array to multi-line
- The actual fix (adding `"button[data-testid='upgrade-cta']"`) is buried in noise
- Makes the diff unreadable in code review

### Good — What Should Happen

```diff
  focusHide: {
-     upgrade: [".juice-container button[data-testid='upgrade']"],
+     upgrade: [".juice-container button[data-testid='upgrade']", "button[data-testid='upgrade-cta']"],
      chips: [".stretch.mx-2"],
      promos: [],
  },
```

One line changed. The fix is obvious. Existing formatting preserved.

---

## 6. Verify Everything — No Regressions

**User Request:** "Make code block corners more rounded in applyStyles()"

### Bad — What Goes Wrong

```javascript
// Changes border-radius in applyStyles() CSS string
css += `pre, .code-block { border-radius: 12px !important; }\n`;
// Says "Done, updated the border radius to 12px"
```

**Problems:**
- `applyStyles()` builds ALL dynamic CSS — themes, typography, code blocks, chat width, message spacing
- Didn't verify that themes still apply (the `:root` custom properties are in the same CSS string)
- Didn't check if `12px` conflicts with platform-specific code block styles
- Didn't test on any platform
- Reported done without any verification

### Good — What Should Happen

```
Changes made:
- Updated border-radius for code blocks in applyStyles() from 8px to 12px

Verification:
1. Fix works: Code blocks now show 12px rounded corners ✓
2. Console errors: None after reload ✓
3. Cross-platform:
   - Claude: Code blocks render correctly, theme colors still applied ✓
   - ChatGPT: Code blocks render correctly ✓
   - Gemini: NOT TESTED — I don't have a Gemini tab open
4. Regression sweep:
   - Themes still apply (checked warmDark + paperLight) ✓
   - BiDi detection still fires on Hebrew text ✓
   - Typography settings (font family, size) still respected ✓
   - Chat width setting still works ✓

Not verified: Gemini platform. The change targets generic selectors
(pre, .code-block) so it should work, but Gemini's code rendering
uses different container elements that may need separate testing.
```

---

## 7. Goal-Driven Execution

**User Request:** "The streaming animation looks wrong"

### Bad — What Goes Wrong

```javascript
// Immediately starts tweaking CSS keyframes
@keyframes aleph-fade-in {
  from { opacity: 0; transform: translateY(8px); }  // was 4px
  to { opacity: 1; transform: translateY(0); }
}
// "I adjusted the animation offset, should look better now"
```

**Problems:**
- Didn't ask which platform, which animation mode, or what "wrong" means
- Guessed at the fix without reproducing the issue
- No verification criteria — how do we know "better" is correct?

### Good — What Should Happen

```
To fix this, I need to define what "looks wrong" means:

1. Which platform? (Claude / ChatGPT / Gemini)
2. Which animation mode? (fadeIn / typewriter / slideUp / glow / none)
3. What's wrong specifically?
   - Animation not playing at all?
   - Playing on old messages, not just new ones?
   - Timing feels off (too fast/slow)?
   - Conflicting with platform's own animation?

Plan once clarified (example: fadeIn on Claude is too jumpy):
1. Reproduce: Open Claude, send a message, observe fadeIn animation
   → verify: Can see the issue
2. Check CSS: Inspect the active animation in content.css
   → verify: [data-aleph-stream-anim="fadeIn"] rules are being applied
3. Fix the timing/easing values
   → verify: Animation looks smooth on new messages
4. Regression: Check that other animation modes still work
   → verify: Switch to typewriter, slideUp — both still play correctly
5. Cross-platform: Test on ChatGPT too
   → verify: fadeIn works the same way
```

---

## Anti-Patterns Summary

| Guideline | Anti-Pattern | Fix |
|-----------|-------------|-----|
| Restate Before Acting | Assumes "fix Hebrew" means BiDi detection | Ask what's broken, where, and on which platform |
| Search Before Building | Writes new `hideGeminiPromo()` function | Add selector to existing `SELECTORS.gemini.focusHide` |
| Generalized Solutions | Patches `hasRTL()` for `<details>` only | Fix the missing selector that prevents `<details>` from being queried |
| Simplicity First | Creates `ThemeBuilder` class for one theme | Add one plain object to `THEMES` matching existing pattern |
| Surgical Changes | Reformats entire selector object while fixing one string | Change only the broken selector string |
| Verify Everything | Changes CSS, says "done" | Verify fix + themes + BiDi + typography, state what wasn't tested |
| Goal-Driven | Tweaks animation CSS without understanding the issue | Define success criteria, reproduce, fix, verify, sweep regressions |
