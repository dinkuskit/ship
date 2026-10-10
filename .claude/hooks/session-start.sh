#!/usr/bin/env bash
# Prepares a Claude Code cloud session for Ship work: Node 22 as in CI and the
# same lockfile install CI runs. Local sessions are left alone. Every step is
# idempotent and a failed step is reported, not fatal, so the session still
# starts and can say what is missing.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$root" || exit 0

status=()
report() {
  printf 'Ship cloud session setup:\n'
  printf -- '- %s\n' "${status[@]}"
}

# Node: CI (.github/workflows/ci.yml) runs Node 22; there is no .nvmrc.
have="$(node -v 2>/dev/null || echo none)"
case "$have" in
  v22.*) status+=("node $have (npm $(npm -v))") ;;
  *)
    status+=("node $have is not Node 22 as in CI; dependencies were not installed. Fix the cloud environment's setup script.")
    report
    exit 0
    ;;
esac

# Dependencies: the CI install, skipped when node_modules was already
# installed from this exact lockfile with this Node.
stamp_file=node_modules/.session-start-stamp
stamp="$have $(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$stamp" ]; then
  status+=("dependencies already match package-lock.json")
elif npm ci --ignore-scripts --no-audit --no-fund >&2; then
  printf '%s' "$stamp" > "$stamp_file"
  status+=("dependencies installed with npm ci --ignore-scripts, as in CI")
else
  status+=("npm ci failed; see the hook output. Do not regenerate the lockfile to fix it.")
fi

status+=("bin/verify-ship quick and full need no provider or credential; sandbox needs a prepared host (skills/ship-verification)")

report
exit 0
