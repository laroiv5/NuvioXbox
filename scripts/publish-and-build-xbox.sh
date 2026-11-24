#!/usr/bin/env bash
set -euo pipefail

GH_BIN="/Users/andreraul/.local/bin/gh"
REPO_DIR="/Users/andreraul/.gemini/antigravity/scratch/NuvioXbox"
OUT_DIR="$HOME/Downloads/NuvioXbox-XboxSeries-x64"
WORKFLOW_NAME="build-xbox-msix.yml"

cd "$REPO_DIR"

if [[ ! -x "$GH_BIN" ]]; then
  echo "gh CLI not found at $GH_BIN" >&2
  exit 1
fi

"$GH_BIN" auth status >/dev/null
"$GH_BIN" auth setup-git

GH_USER="$("$GH_BIN" api user --jq '.login')"
REPO_SLUG="${GH_USER}/NuvioXbox"
TARGET_REMOTE="https://github.com/${REPO_SLUG}.git"
CURRENT_ORIGIN="$(git remote get-url origin 2>/dev/null || true)"

if [[ "$CURRENT_ORIGIN" != "$TARGET_REMOTE" ]]; then
  if "$GH_BIN" repo view "$REPO_SLUG" >/dev/null 2>&1; then
    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "$TARGET_REMOTE"
    else
      git remote add origin "$TARGET_REMOTE"
    fi
    git push -u origin main
  else
    git remote remove origin >/dev/null 2>&1 || true
    "$GH_BIN" repo create NuvioXbox --private --source=. --remote=origin --push
  fi
else
  git push -u origin main
fi

"$GH_BIN" repo set-default "$REPO_SLUG" >/dev/null 2>&1 || true

echo "Waiting for GitHub Actions workflow ($WORKFLOW_NAME) to start..."
RUN_ID=""
for _ in $(seq 1 18); do
  RUN_ID="$("$GH_BIN" run list -R "$REPO_SLUG" --workflow="$WORKFLOW_NAME" --branch main --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
  if [[ -n "$RUN_ID" ]]; then
    break
  fi
  sleep 5
done

if [[ -z "$RUN_ID" ]]; then
  echo "Workflow run did not appear automatically; triggering workflow_dispatch..."
  "$GH_BIN" workflow run "$WORKFLOW_NAME" -R "$REPO_SLUG" --ref main
  for _ in $(seq 1 12); do
    sleep 5
    RUN_ID="$("$GH_BIN" run list -R "$REPO_SLUG" --workflow="$WORKFLOW_NAME" --branch main --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
    if [[ -n "$RUN_ID" ]]; then
      break
    fi
  done
fi

if [[ -z "$RUN_ID" ]]; then
  echo "Could not locate GitHub Actions run ID for $WORKFLOW_NAME." >&2
  exit 1
fi

echo "Watching GitHub Actions run $RUN_ID..."
"$GH_BIN" run watch "$RUN_ID" -R "$REPO_SLUG" --exit-status

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
"$GH_BIN" run download "$RUN_ID" -R "$REPO_SLUG" --name NuvioXbox-XboxSeries-x64 --dir "$OUT_DIR"

/usr/bin/osascript -e 'display notification "Pachetul Xbox (.msix) este gata in Downloads/NuvioXbox-XboxSeries-x64" with title "NuvioXbox"' >/dev/null 2>&1 || true

echo "Downloaded artifact files:"
find "$OUT_DIR" -maxdepth 3 -type f | sort
