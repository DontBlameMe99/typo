#!/usr/bin/env bash
# Repeatable emulator proof for Typo audit threads. It installs an APK, seeds a
# fictional vault through the system folder picker, and captures named scenarios.
# Screenshots and session state go to fresh directories made with mktemp -p .tmp.
#
# Usage:
#   AGENT_DEVICE=<t3 agent-device path> ./scripts/audit-capture.sh run pdf \
#     --apk android/app/build/outputs/apk/release/app-release.apk --device emulator-5556
#   ./scripts/audit-capture.sh plan <scenario>
#   ./scripts/audit-capture.sh cleanup
#
# Scenarios: library, pdf, trash, rename, quick, redaction. The optional --boot
# flag boots the selected device; cleanup shuts it down only when this script
# booted it. Without --boot, cleanup ends the agent-device session only.
# Use --replace-app only on a disposable device when the APK signature changed.
# The quick scenario expects the Typo tiles to be in Quick Settings already.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

AGENT=${AGENT_DEVICE:-agent-device}
PACKAGE=${TYPO_PACKAGE:-org.dontblameme.typo}
DEVICE=${ANDROID_SERIAL:-}
APK=
BOOT=0
REPLACE=0
MODE=run
SCENARIO=
SHOTS=
STATE=

die() { printf 'audit-capture: %s\n' "$*" >&2; exit 1; }

show() {
  printf '  '
  printf '%q ' "$@"
  printf '\n'
}

emit() {
  if [[ $MODE == plan ]]; then
    show "$@"
  else
    show "$@"
    "$@"
  fi
}
agent() {
  if [[ -n $DEVICE ]]; then
    emit "$AGENT" "$@" --serial "$DEVICE"
  else
    emit "$AGENT" "$@"
  fi
}
wait_text() { agent wait text "$1" "$2"; }

parse() {
  local command=${1:-}
  [[ -n $command ]] || die 'expected run, plan, or cleanup'
  shift || true
  case $command in
    run | plan)
      [[ -n ${1:-} ]] || die 'expected a scenario name'
      SCENARIO=$1
      shift
      MODE=$command
      ;;
    cleanup) MODE=cleanup ;;
    *) die "unknown command: $command" ;;
  esac
  while (($#)); do
    case $1 in
      --apk) APK=$2; shift 2 ;;
      --device) DEVICE=$2; shift 2 ;;
      --agent) AGENT=$2; shift 2 ;;
      --boot) BOOT=1; shift ;;
      --replace-app) REPLACE=1; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done
}

steps_picker() {
  wait_text 'Open a folder' 180000
  agent press 'label="Open a folder"' --settle
  wait_text 'USE THIS FOLDER' 30000
  if [[ $MODE == plan ]] || ! agent is visible 'text="Download"'; then
    agent press 'label="Show roots"' --settle
  fi
  wait_text 'Download' 30000
  agent press 'text="Download"' --settle
  wait_text 'typo-audit-demo' 30000
  agent press 'text="typo-audit-demo"' --settle
  wait_text 'USE THIS FOLDER' 30000
  agent press 'text="USE THIS FOLDER"' --settle
  agent alert accept || true
  if [[ $MODE == plan ]] || agent is visible 'text="ALLOW"'; then
    agent press 'text="ALLOW"' --settle
  fi
  wait_text 'Folder Inbox' 90000
}

steps_library() {
  agent press 'label="Folder Inbox, 2 notes"' --settle
  wait_text 'Welcome to Nimbus' 30000
  agent screenshot "$SHOTS/01-library.png"
  agent fill 'label="Find a thought…"' 'NIMBUS-DEMO' --settle
  wait_text 'NIMBUS-DEMO' 30000
  agent screenshot "$SHOTS/02-search.png"
}

steps_pdf() {
  agent press 'label="Folder Projects, 2 notes"' --settle
  wait_text 'Nimbus Atlas' 30000
  agent press 'text="Nimbus Atlas"' --settle
  wait_text 'Source' 30000
  agent screenshot "$SHOTS/03-source.png"
  agent press 'text="PDF"' --settle
  wait_text 'PDF' 30000
  agent screenshot "$SHOTS/04-pdf.png"
  agent press 'label="Close note"' --settle
}

steps_trash() {
  agent press 'label="Folder Inbox, 2 notes"' --settle
  wait_text 'Welcome to Nimbus' 30000
  agent wait stable 500 10000
  agent swipe 950 650 100 650
  wait_text 'Undo move to trash' 30000
  agent screenshot "$SHOTS/05-trash.png"
  agent press 'label="Undo move to trash"' --settle
  wait_text 'Welcome to Nimbus' 60000
  agent screenshot "$SHOTS/06-restored.png"
}

steps_rename() {
  emit env ANDROID_SERIAL="$DEVICE" bun scripts/audit-demo-seed.ts --push \
    --rename-title 'NIMBUS-DEMO Renamed Beacon'
  agent open "$PACKAGE" --relaunch --foreground
  wait_text 'Folder Inbox' 90000
  agent press 'label="Folder Inbox, 2 notes"' --settle
  wait_text 'NIMBUS-DEMO Renamed Beacon' 30000
  agent screenshot "$SHOTS/07-renamed.png"
}

steps_quick() {
  agent home
  agent swipe 540 20 540 900
  agent swipe 540 20 540 900
  wait_text 'New note' 30000
  agent press 'text="New note"' --settle
  wait_text 'Note title' 30000
  agent screenshot "$SHOTS/08-quick-note.png"
  agent press 'label="Close quick note"' --settle
}

steps_redaction() {
  agent press 'label="Folder Inbox, 2 notes"' --settle
  wait_text 'NIMBUS-DEMO-REDACTION-CHECK' 30000
  agent is absent 'text="REAL_USER_DATA_SENTINEL"'
  agent screenshot "$SHOTS/09-redaction.png"
}

steps_setup() {
  ((BOOT == 0)) || agent boot --headless
  ((REPLACE == 0)) || agent uninstall "$PACKAGE"
  agent install "$PACKAGE" "$APK"
  agent settings clear-app-state "$PACKAGE"
  emit env ANDROID_SERIAL="$DEVICE" bun scripts/audit-demo-seed.ts --push
  agent open "$PACKAGE" --relaunch --foreground
  agent alert dismiss || true
  steps_picker
}

cleanup() {
  local state agent_path booted status output old
  local -a states=()
  shopt -s nullglob
  for state in .tmp/audit-session-*.json; do states+=("$state"); done
  if ((${#states[@]} == 0)); then
    printf 'audit-capture: cleanup finished\n'
    return
  fi
  state=${states[0]}
  for candidate in "${states[@]}"; do
    [[ $candidate -nt $state ]] && state=$candidate
  done
  for old in "${states[@]}"; do
    [[ $old == "$state" ]] || command rm -f "$old"
  done
  # shellcheck source=/dev/null
  source "$state"
  agent_path=${AGENT_PATH:-}
  booted=${BOOTED:-0}
  if [[ -z $agent_path ]]; then
    command rm -f "$state"
    printf 'audit-capture: cleanup finished\n'
    return
  fi
  status=0
  if [[ $booted == 1 ]]; then
    show "$agent_path" close --shutdown --force
    output=$("$agent_path" close --shutdown --force 2>&1) || status=$?
  else
    show "$agent_path" close --force
    output=$("$agent_path" close --force 2>&1) || status=$?
  fi
  printf '%s\n' "$output"
  if ((status == 0)) || [[ $output == *SESSION_NOT_FOUND* ]]; then
    command rm -f "$state"
  else
    printf 'audit-capture: kept %s after close failure\n' "$state" >&2
  fi
  printf 'audit-capture: cleanup finished\n'
}

parse "$@"

if [[ $MODE == cleanup ]]; then
  cleanup
  exit 0
fi

[[ -n $SCENARIO ]] || die 'expected a scenario name'
case $SCENARIO in
  library | pdf | trash | rename | quick | redaction | setup) ;;
  *) die "unknown scenario: $SCENARIO" ;;
esac

if [[ $MODE == run ]]; then
  [[ -n $APK ]] || die 'run needs --apk <path>'
  [[ -n $DEVICE ]] || die 'run needs --device <serial>'
  [[ -f $APK ]] || die "APK not found: $APK"
  mkdir -p .tmp
  SHOTS=$(mktemp -d -p .tmp audit-shots-XXXXXX)
  STATE=$(mktemp -p .tmp audit-session-XXXXXX.json)
  printf 'AGENT_PATH=%q\nBOOTED=%q\n' "$AGENT" "$BOOT" >"$STATE"
  printf 'SHOTS_DIR=%s\nSTATE_FILE=%s\n' "$SHOTS" "$STATE"
else
  SHOTS='.tmp/audit-shots-XXXXXX'
fi

steps_setup
if [[ $SCENARIO != setup ]]; then
  "steps_$SCENARIO"
fi
printf 'audit-capture: %s %s complete\n' "$MODE" "$SCENARIO"
