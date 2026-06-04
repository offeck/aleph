#!/bin/bash

# Setup symbolic links for AI tool configuration
# Ensures single source of truth with no duplication.
# Ported from the Selectika monorepo symlink architecture.
#
# Source of Truth:
#   Rules:  CLAUDE.md
#   Agents: .agents/agents/*.md
#   Skills: .agents/skills/*/SKILL.md
#
# Targets:
#   .claude/agents/<name>/AGENT.md  -> .agents/agents/<name>.md   (symlink)
#   .claude/skills/<name>           -> .agents/skills/<name>      (symlink)
#   .codex/agents/<name>/AGENT.md   -> .agents/agents/<name>.md   (path-ref)
#   .codex/skills/<name>            -> .agents/skills/<name>      (symlink)
#   .gemini/agents/<name>.md        -> .agents/agents/<name>.md   (symlink)
#   .gemini/skills/<name>           -> .agents/skills/<name>      (symlink)
#   .opencode/agents/<name>.md      -> .agents/agents/<name>.md   (symlink)
#   .opencode/skills/<name>         -> .agents/skills/<name>      (symlink)
#   AGENTS.md                       -> CLAUDE.md                  (symlink; read natively by Codex/OpenCode)

set -e

# Enable native Windows symlinks in Git Bash (requires Developer Mode)
export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
USE_LINK_FILES=0

# Probe whether symlinks actually work (don't trust core.symlinks — it lies on Windows)
_probe_target="$REPO_ROOT/.symlink-probe-$$"
if ln -sf "$REPO_ROOT/CLAUDE.md" "$_probe_target" 2>/dev/null && [ -L "$_probe_target" ]; then
    rm -f "$_probe_target"
    # Make git store/checkout these as real symlinks
    git -C "$REPO_ROOT" config core.symlinks true 2>/dev/null || true
else
    rm -f "$_probe_target"
    USE_LINK_FILES=1
fi

# Source directories
AGENTS_SRC="$REPO_ROOT/.agents/agents"
SKILLS_SRC="$REPO_ROOT/.agents/skills"

# Target directories
CLAUDE_AGENTS="$REPO_ROOT/.claude/agents"
CLAUDE_SKILLS="$REPO_ROOT/.claude/skills"
CODEX_AGENTS="$REPO_ROOT/.codex/agents"
CODEX_SKILLS="$REPO_ROOT/.codex/skills"
GEMINI_AGENTS="$REPO_ROOT/.gemini/agents"
GEMINI_SKILLS="$REPO_ROOT/.gemini/skills"
OPENCODE_AGENTS="$REPO_ROOT/.opencode/agents"
OPENCODE_SKILLS="$REPO_ROOT/.opencode/skills"

# Function to create symlink (relative)
create_symlink() {
    local source="$1"
    local target="$2"
    local rel_source
    rel_source=$(realpath --relative-to="$(dirname "$target")" "$source" 2>/dev/null || python3 -c "import os.path; print(os.path.relpath('$source', '$(dirname "$target")'))")

    if [ -L "$target" ]; then
        echo "  i  Symlink exists: $target"
        return
    elif [ -f "$target" ]; then
        local existing_content
        existing_content=$(cat "$target")
        if [ "$existing_content" = "$rel_source" ]; then
            if [ "$USE_LINK_FILES" -eq 1 ]; then
                echo "  i  Link-file exists: $target"
                return
            fi
            # Stale link-file on a symlink-capable system — upgrade to real symlink
            rm -f "$target"
        else
            echo "  !  Regular file exists, backing up: $target"
            mv "$target" "$target.bak"
        fi
    elif [ -d "$target" ]; then
        if [ "$USE_LINK_FILES" -eq 1 ] && [ -d "$source" ] && diff -rq "$source" "$target" >/dev/null 2>&1; then
            echo "  i  Directory exists: $target"
            return
        fi
        rm -rf "$target"
    else
        mkdir -p "$(dirname "$target")"
    fi

    if [ "$USE_LINK_FILES" -eq 1 ]; then
        if [ -d "$source" ]; then
            cp -r "$source" "$target"
            echo "  +  Copied directory: $target <- $source"
        else
            printf '%s' "$rel_source" > "$target"
            echo "  +  Created link-file: $target -> $source"
        fi
    else
        ln -sf "$rel_source" "$target"
        if [ -L "$target" ]; then
            echo "  +  Created symlink: $target -> $source"
        else
            # ln -sf silently copied instead of symlinking (common on Windows)
            echo "  ~  Symlink fell back to copy: $target <- $source"
        fi
    fi
}

# Function to sync a regular file from a source file
# Used for compatibility files where a symlink would degrade into a path string
create_synced_copy() {
    local source="$1"
    local target="$2"

    if [ -f "$target" ] && cmp -s "$source" "$target"; then
        echo "  i  Synced copy exists: $target"
        return
    fi

    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
    echo "  +  Synced copy: $target <- $source"
}

# Function to create path-reference file
# Used where tools resolve a file containing the relative path instead of a symlink
create_path_ref() {
    local source="$1"
    local target="$2"
    local rel_source
    rel_source=$(realpath --relative-to="$(dirname "$target")" "$source" 2>/dev/null || python3 -c "import os.path; print(os.path.relpath('$source', '$(dirname "$target")'))")

    if [ -L "$target" ]; then
        rm -f "$target"
    elif [ -f "$target" ]; then
        local existing_content
        existing_content=$(cat "$target")
        if [ "$existing_content" = "$rel_source" ]; then
            echo "  i  Path-ref exists: $target"
            return
        fi
    fi
    mkdir -p "$(dirname "$target")"
    printf '%s' "$rel_source" > "$target"
    echo "  +  Created path-ref: $target -> $source"
}

# ─────────────────────────────────────────────────────────
# 1. Claude Code Agents <- .agents/agents
# ─────────────────────────────────────────────────────────
echo ""
echo "=== Claude Code Agents ==="
mkdir -p "$CLAUDE_AGENTS"

for agent_file in "$AGENTS_SRC"/*.md; do
    [ -f "$agent_file" ] || continue
    agent_name=$(basename "$agent_file" .md)
    if [ "$USE_LINK_FILES" -eq 1 ]; then
        create_synced_copy "$agent_file" "$CLAUDE_AGENTS/$agent_name/AGENT.md"
    else
        create_symlink "$agent_file" "$CLAUDE_AGENTS/$agent_name/AGENT.md"
    fi
done

# ─────────────────────────────────────────────────────────
# 2. Claude Code Skills <- .agents/skills
# ─────────────────────────────────────────────────────────
echo ""
echo "=== Claude Code Skills ==="
mkdir -p "$CLAUDE_SKILLS"

for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    create_symlink "${skill_dir%/}" "$CLAUDE_SKILLS/$skill_name"
done

# ─────────────────────────────────────────────────────────
# 3. Codex Agents <- .agents/agents (path-refs)
# ─────────────────────────────────────────────────────────
echo ""
echo "=== Codex Agents ==="
mkdir -p "$CODEX_AGENTS"

for agent_file in "$AGENTS_SRC"/*.md; do
    [ -f "$agent_file" ] || continue
    agent_name=$(basename "$agent_file" .md)
    create_path_ref "$agent_file" "$CODEX_AGENTS/$agent_name/AGENT.md"
done

# ─────────────────────────────────────────────────────────
# 4. Codex Skills <- .agents/skills
# ─────────────────────────────────────────────────────────
echo ""
echo "=== Codex Skills ==="
mkdir -p "$CODEX_SKILLS"

for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    create_symlink "${skill_dir%/}" "$CODEX_SKILLS/$skill_name"
done

# ─────────────────────────────────────────────────────────
# 5. Gemini & OpenCode Agents <- .agents/agents
# ─────────────────────────────────────────────────────────
echo ""
echo "=== Gemini & OpenCode Agents ==="
mkdir -p "$GEMINI_AGENTS" "$OPENCODE_AGENTS"

for agent_file in "$AGENTS_SRC"/*.md; do
    [ -f "$agent_file" ] || continue
    agent_name=$(basename "$agent_file")
    create_symlink "$agent_file" "$GEMINI_AGENTS/$agent_name"
    create_symlink "$agent_file" "$OPENCODE_AGENTS/$agent_name"
done

# ─────────────────────────────────────────────────────────
# 6. Gemini & OpenCode Skills <- .agents/skills
# ─────────────────────────────────────────────────────────
echo ""
echo "=== Gemini & OpenCode Skills ==="
mkdir -p "$GEMINI_SKILLS" "$OPENCODE_SKILLS"

for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    create_symlink "${skill_dir%/}" "$GEMINI_SKILLS/$skill_name"
    create_symlink "${skill_dir%/}" "$OPENCODE_SKILLS/$skill_name"
done

# ─────────────────────────────────────────────────────────
# 7. AGENTS.md Root Compatibility <- CLAUDE.md
# ─────────────────────────────────────────────────────────
echo ""
echo "=== AGENTS.md Root Compatibility ==="
if [ "$USE_LINK_FILES" -eq 1 ]; then
    # Link-files don't work for root config — other tools read AGENTS.md directly
    create_synced_copy "$REPO_ROOT/CLAUDE.md" "$REPO_ROOT/AGENTS.md"
else
    create_symlink "$REPO_ROOT/CLAUDE.md" "$REPO_ROOT/AGENTS.md"
fi

# ─────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────
echo ""
echo "Done!"
echo ""
echo "Source of Truth:"
echo "  Rules:  CLAUDE.md"
echo "  Agents: .agents/agents/*.md"
echo "  Skills: .agents/skills/*/SKILL.md"
echo ""
echo "Targets:"
echo "  .claude/    (agents, skills)"
echo "  .codex/     (agents, skills)"
echo "  .gemini/    (agents, skills)"
echo "  .opencode/  (agents, skills)"
echo "  AGENTS.md   (symlink to CLAUDE.md)"
echo ""
echo "Edit source files only. Never edit symlinks or path-reference files."
