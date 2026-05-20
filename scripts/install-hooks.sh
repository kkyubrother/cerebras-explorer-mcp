#!/usr/bin/env bash
# One-time installer: points git at scripts/hooks/ as the hooks directory.
# Safe to re-run. To uninstall: git config --unset core.hooksPath

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: must be run inside the cerebras-explorer-mcp git repo." >&2
  exit 1
fi

cd "$REPO_ROOT"

if [ ! -f scripts/hooks/pre-commit ]; then
  echo "Error: scripts/hooks/pre-commit not found." >&2
  exit 1
fi

chmod +x scripts/hooks/pre-commit
git config core.hooksPath scripts/hooks

echo "Installed: git pre-commit hook will run 'npm test' before each commit."
echo "  Bypass once (not recommended): git commit --no-verify"
echo "  Uninstall:                     git config --unset core.hooksPath"
