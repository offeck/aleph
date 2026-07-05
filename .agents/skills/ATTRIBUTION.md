# Ported skills — attribution & provenance

Most skills in this directory are Recomento-original. The marketing skills below were
**ported from two MIT-licensed open-source collections on 2026-06-30** and adapted to this
repo's structure (kept `SKILL.md` + `references/`; for the two scripted skills kept
`scripts/` + `.env.example`; dropped each skill's `evals/` and per-skill `README.md`).

This file is not a skill — `setup-links.ps1` only symlinks *directories* into `.claude/skills`,
so a top-level `.md` here is ignored by the skill loader. It exists to satisfy the MIT notice
requirement and record where each skill came from.

## Source 1 — coreyhaines31/marketingskills (MIT, © 2025 Corey Haines)
- Repo: https://github.com/coreyhaines31/marketingskills · commit `8bfcdff`
- Ported (18): `ai-seo` · `analytics` · `aso` · `cold-email` · `competitors` · `content-strategy` ·
  `copy-editing` · `copywriting` · `cro` · `customer-research` · `launch` · `marketing-psychology` ·
  `pricing` · `product-marketing` · `prospecting` · `schema` · `seo-audit` · `social`

## Source 2 — Varnan-Tech/opendirectory (MIT, © 2026 Varnan-Tech)
- Repo: https://github.com/Varnan-Tech/opendirectory · commit `9c30f79`
- Ported (3): `human-tone` · `pricing-page-psychology-audit` · `where-your-customer-lives`
- Script notes: `where-your-customer-lives` is **stdlib-only** Python (no pip deps; `GITHUB_TOKEN`
  optional for rate limits). `pricing-page-psychology-audit` needs `pip install requests
  beautifulsoup4` to run its scraper — or skip the script and fetch the page with built-in web tools.
  Both `.env.example` files hold only optional, commented config — no secrets.

## How these relate to Recomento's own skills
These are generic **technique** skills. The repo's own skills remain authoritative where they overlap:
- **`marketing-content`** governs what we may claim (encodes planning/42 scope + financials/31 pricing) —
  it wins over any generic copy/pricing skill on claims, pricing, and voice.
- **`shopify-expert`** owns Shopify platform mechanics; `aso` only adds listing-optimization technique.
- **`research`/`deep-research`** are the rigor standard; `customer-research`/`prospecting`/
  `where-your-customer-lives` are tactical playbooks under it.
- **`financial-model`** owns our unit economics; `pricing`/`pricing-page-psychology-audit` add strategy/psychology.

A few ported marketingskills `SKILL.md`s contain "see also" cross-references to sibling skills we did
**not** port — those hints are harmless no-ops.

---

## MIT License — coreyhaines31/marketingskills

```
MIT License

Copyright (c) 2025 Corey Haines

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MIT License — Varnan-Tech/opendirectory

```
MIT License

Copyright (c) 2026 Varnan-Tech

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
