# AI Tools Navigation

Universal index for the Aleph AI tool ecosystem.
Single-source-of-truth symlink architecture, ported from the Selectika monorepo.

---

## Source of Truth

Edit these files. Everything else is a symlink (or a synced copy on systems without symlink support).

| Type | Source Location | Count |
|------|----------------|-------|
| Rules | `CLAUDE.md` | 1 |
| Agents | `.agents/agents/*.md` | 5 |
| Skills | `.agents/skills/*/SKILL.md` | 2 |

---

## Tool Coverage Matrix

| Resource | Claude Code | Codex | Gemini | OpenCode |
|----------|:-----------:|:-----:|:------:|:--------:|
| Rules | `CLAUDE.md` (native) | `AGENTS.md` (native) | - | `AGENTS.md` (native) |
| Agents | `.claude/agents/` | `.codex/agents/` | `.gemini/agents/` | `.opencode/agents/` |
| Skills | `.claude/skills/` | `.codex/skills/` | `.gemini/skills/` | `.opencode/skills/` |

`AGENTS.md` is a symlink to `CLAUDE.md`, so tools that read it natively get the same rules.

---

## Agents (5)

| Agent | Purpose | Source |
|-------|---------|--------|
| **issue-investigator** | Root cause analysis of visual bugs (BiDi, LaTeX, theme, focus mode, streaming) | `.agents/agents/issue-investigator.md` |
| **issue-planner** | Plans general, non-monkey-patch fixes; researches competing tools | `.agents/agents/issue-planner.md` |
| **regression-tester** | Runs visual regression tests against all sessions in `tests/sessions.json` | `.agents/agents/regression-tester.md` |
| **marketing-writer** | Drafts venue-adapted marketing copy (EN/HE/AR) in brand voice; never posts | `.agents/agents/marketing-writer.md` |
| **seo-auditor** | Audits the CWS listing vs keyword-spam policy + keyword strategy; read-only | `.agents/agents/seo-auditor.md` |

---

## Skills (2)

| Skill | Purpose | Source |
|-------|---------|--------|
| **fix-issue** | End-to-end bug fix workflow: reproduce, investigate, plan, implement, verify, regression-test | `.agents/skills/fix-issue/SKILL.md` |
| **marketing** | Marketing ops console: plan / post / log / audit / scout over `marketing/*.md` | `.agents/skills/marketing/SKILL.md` |

---

## Architecture

```text
Source of Truth                          Symlink Targets (DRY)

CLAUDE.md -----------------------------> AGENTS.md  (symlink)

.agents/agents/*.md ---+---------------> .claude/agents/*/AGENT.md    (symlink)
                       +---------------> .codex/agents/*/AGENT.md     (path-ref)
                       +---------------> .gemini/agents/*.md          (symlink)
                       +---------------> .opencode/agents/*.md        (symlink)

.agents/skills/*/ -----+---------------> .claude/skills/*    (symlink)
                       +---------------> .codex/skills/*     (symlink)
                       +---------------> .gemini/skills/*    (symlink)
                       +---------------> .opencode/skills/*  (symlink)
```

### Link Types

- **Symlink**: OS-level `ln -s`, followed transparently by all tools
- **Path-reference** (Codex agents): file containing the relative path, resolved by the tool internally
- **Synced copy** (fallback): used only when the filesystem can't create symlinks

---

## Setup

Run after cloning or when source files change:

```bash
bash scripts/setup-symlinks.sh
```

Probes symlink capability, sets `git config core.symlinks true`, validates existing
links, creates missing ones, backs up regular files. On Windows, requires Developer
Mode for unprivileged symlink creation (falls back to copies otherwise).

---

## Usage Guidelines

**DO:** edit source files (`CLAUDE.md`, `.agents/agents/*.md`, `.agents/skills/*/SKILL.md`)

**DON'T:** edit symlinks or path-refs (`AGENTS.md`, anything under `.claude/`, `.codex/`, `.gemini/`, `.opencode/`)

---

## Related Docs

- [CLAUDE.md](../CLAUDE.md) - Development guidelines and project architecture (source file)
