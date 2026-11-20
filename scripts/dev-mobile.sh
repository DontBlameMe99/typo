#!/usr/bin/env bash
# Start a Metro server for testing a worktree in Expo Go. A server stops on its
# own once its worktree is deleted.
#
#   ./scripts/dev-mobile.sh start [--host <host>] [--port <port>]
#   ./scripts/dev-mobile.sh status
#   ./scripts/dev-mobile.sh rebuild
#
# See AGENTS.md and .agents/skills/mobile-testing/SKILL.md.
# shellcheck disable=SC2153
set -euo pipefail

script_path="$(readlink -f "$0")"
root="$(git rev-parse --show-toplevel)"
cd "$root"

die() {
  echo "dev-mobile: $*" >&2
  exit 1
}

# The lock is held on fd 10 through exec, so the kernel releases the slot when
# the server exits, even if no agent stops it.
acquire_slot() {
  local i
  mkdir -p "$slot_dir"
  for ((i = 1; i <= slot_count; i++)); do
    exec 10>"$slot_dir/slot-$i" || continue
    if flock -n 10; then
      return 0
    fi
    exec 10>&-
  done
  die "All $slot_count dev server slots are in use. Wait for a lease to expire or stop a server."
}

usage() {
  sed -n '5,7p' "$script_path" | sed 's/^# \{0,1\}//'
}

cmd="${1:-}"
case "$cmd" in
  start|status|rebuild) shift ;;
  help|--help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# Re-run inside the Nix shell before parsing options, so all arguments survive.
if [[ $cmd == start || $cmd == rebuild ]]; then
  if ! command -v bun >/dev/null || ! command -v wasm-opt >/dev/null || ! command -v node >/dev/null; then
    if [[ -n ${TYPO_DEV_MOBILE_NIX:-} ]]; then
      die "bun, wasm-opt, and node are required. Run this from 'nix develop'."
    fi
    command -v nix >/dev/null || die "bun is not installed and nix is unavailable."
    export TYPO_DEV_MOBILE_NIX=1
    exec nix develop -c "$script_path" "$cmd" "$@"
  fi
fi

state_dir="$root/.expo"
state="$state_dir/dev-mobile"
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/typo-dev"
log_dir="$cache_dir/logs"
ports_dir="$cache_dir/ports"
reserved_port=""
picked_port=""


slot_dir="${XDG_CACHE_HOME:-$HOME/.cache}/dev-server-slots"
slot_count=4
server_ttl=3600
cleanup_port_reservation() {
  if [[ -n $reserved_port ]]; then
    rm -rf "${ports_dir:?}/${reserved_port:?}"
  fi
}
trap cleanup_port_reservation EXIT

write_state() {
  mkdir -p "$state_dir"
  local tmp
  tmp="$(mktemp "$state.XXXXXX")"
  {
    printf 'PID=%q\n' "$1"
    printf 'PORT=%q\n' "$2"
    printf 'HOST=%q\n' "$3"
    printf 'URL=%q\n' "$4"
    printf 'BRANCH=%q\n' "$5"
    printf 'WORKTREE=%q\n' "$6"
    printf 'LOG=%q\n' "$7"
  } >"$tmp"
  mv "$tmp" "$state"
}

kill_server() {
  local pid="$1" pgid=""
  kill -0 "$pid" 2>/dev/null || return 0
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n $pgid && $pgid == "$pid" ]]; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  for _ in {1..50}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  if [[ -n $pgid && $pgid == "$pid" ]]; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  else
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

# Prints the directory a live PID holds, with a trailing " (deleted)" once that
# directory is gone.
process_cwd() {
  readlink "/proc/$1/cwd" 2>/dev/null || true
}

# True when the PID is this worktree's Expo CLI, not a recycled PID. PIDs get
# reused, so prove that before killing anything.
owns_server() {
  [[ "$(process_cwd "$1")" == "$root" ]] || return 1
  grep -qaF -- "$root/node_modules/.bin/expo" "/proc/$1/cmdline" 2>/dev/null
}

# Removes reservations whose server is gone. The port lock also excludes a start
# that is reserving that port right now.
prune_state() {
  local dir port pid
  for dir in "${ports_dir:?}"/*/; do
    [[ -d $dir ]] || continue
    port="$(basename "$dir")"
    exec 9>"$ports_dir/$port.lock" || continue
    if ! flock -n 9; then
      exec 9>&-
      continue
    fi
    pid="$(cat "$dir/pid" 2>/dev/null || true)"
    if [[ -z $pid ]] || ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$dir"
    fi
    exec 9>&-
  done
}

acquire_worktree_lock() {
  mkdir -p "$state_dir"
  exec 8>"$state_dir/start.lock"
  if ! flock -w 300 8; then
    die "Timed out waiting for this worktree's previous start."
  fi
}

release_worktree_lock() {
  flock -u 8 2>/dev/null || true
  exec 8>&-
}

detect_host() {
  if [[ -n ${DEV_HOST:-} ]]; then
    printf '%s\n' "$DEV_HOST"
    return
  fi
  if command -v tailscale >/dev/null; then
    local name
    name="$(
      tailscale status --json 2>/dev/null |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=JSON.parse(s).Self.DNSName;if(n)console.log(n.replace(/\.$/,""))}catch{}})' 2>/dev/null
    )"
    if [[ -n $name ]]; then
      printf '%s\n' "$name"
      return
    fi
    local ip
    ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    if [[ -n $ip ]]; then
      printf '%s\n' "$ip"
      return
    fi
  fi
  hostname -I 2>/dev/null | awk '{print $1}'
}

port_free() {
  node -e '
    const net = require("net")
    const s = net.createServer()
    s.once("error", () => process.exit(1))
    s.listen(Number(process.argv[1]), "0.0.0.0", () => s.close(() => process.exit(0)))
  ' "$1" 2>/dev/null
}

try_reserve_port() {
  local p="$1" dir="$ports_dir/$1" pid="" owner_cwd="" owner_worktree=""
  mkdir -p "$ports_dir"
  exec 7>"$ports_dir/$p.lock"
  if ! flock -n 7; then
    exec 7>&-
    return 1
  fi
  if [[ -d $dir ]]; then
    pid="$(cat "$dir/pid" 2>/dev/null || true)"
    owner_worktree="$(cat "$dir/worktree" 2>/dev/null || true)"
    if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
      owner_cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
      if [[ -z $owner_cwd || -z $owner_worktree || $owner_cwd == "$owner_worktree" ]]; then
        exec 7>&-
        return 1
      fi
    fi
    rm -rf "$dir"
  fi
  if ! port_free "$p"; then
    exec 7>&-
    return 1
  fi
  if ! mkdir "$dir"; then
    exec 7>&-
    return 1
  fi
  printf '%s\n' "$$" >"$dir/pid"
  printf '%s\n' "$root" >"$dir/worktree"
  date +%s >"$dir/started"
  reserved_port="$p"
  exec 7>&-
  return 0
}

pick_port() {
  # Stable per worktree, so the link stays the same.
  local base p i
  base="$(
    node -e 'const h=require("crypto").createHash("sha1").update(process.argv[1]).digest().readUInt16BE(0);process.stdout.write(String(8100+(h%100)))' \
      "$root"
  )"
  for i in $(seq 0 99); do
    p=$((8100 + (base - 8100 + i) % 100))
    if try_reserve_port "$p"; then
      picked_port="$p"
      return 0
    fi
  done
  die "No free port between 8100 and 8199."
}

build_dist() {
  local force="${1:-0}" stamp="$root/dist/.dev-mobile-stamp" f
  if [[ $force -eq 0 && -f $stamp ]]; then
    for f in editor editor-worker compiler compiler-worker pdf pdf-worker search; do
      if [[ ! -f "$root/dist/$f.bundle.txt" ]]; then
        force=1
        break
      fi
    done
    [[ -f $root/dist/compiler.wasm ]] || force=1
  fi
  if [[ $force -eq 0 && -f $stamp ]]; then
    if ! find src/editor src/compiler src/pdf src/search src/core.ts src/web-runtime.ts scripts/build-web.ts \
      package.json bun.lock -newer "$stamp" -print -quit 2>/dev/null | grep -q .; then
      echo "dist is up to date."
      return
    fi
  fi
  echo "Building web bundles..."
  bun run build:web
  touch "$stamp"
}

start_server() {
  local host="" port="" heal_port=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host|--port)
        [[ $# -ge 2 ]] || die "$1 needs a value."
        case "$1" in
          --host) host="$2" ;;
          --port) port="$2" ;;
        esac
        shift 2
        ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  command -v setsid >/dev/null || die "setsid is required to run the server."
  prune_state
  acquire_worktree_lock
  if [[ -f $state ]]; then
    # shellcheck disable=SC1090
    source "$state"
    if kill -0 "$PID" 2>/dev/null; then
      if curl -fsS -m 2 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1; then
        release_worktree_lock
        echo "Already running on port $PORT."
        echo "Link: $URL"
        echo "Log: $LOG"
        return
      fi
      # Alive but not answering: the server is wedged. Kill its group so its
      # port can be reused.
      if owns_server "$PID"; then
        kill_server "$PID"
        # The listening socket can outlive the process for a moment.
        for _ in {1..25}; do
          port_free "$PORT" && break
          sleep 0.2
        done
        heal_port="$PORT"
      fi
    fi
    rm -f "$state"
    # A stale state file can name a port another worktree now owns.
    if [[ "$(cat "$ports_dir/$PORT/worktree" 2>/dev/null)" == "$root" ]]; then
      rm -rf "${ports_dir:?}/${PORT:?}"
    fi
  fi

  [[ -n $host ]] || host="$(detect_host)"
  [[ -n $host ]] || die "Could not detect a network host. Pass --host."

  bun install --frozen-lockfile
  build_dist 0

  if [[ -n $port ]]; then
    try_reserve_port "$port" || die "Port $port is in use."
  elif [[ -n $heal_port ]] && try_reserve_port "$heal_port"; then
    # Keep the link the user already holds.
    port="$heal_port"
  else
    pick_port
    port="$picked_port"
  fi

  mkdir -p "$log_dir"
  log="$log_dir/$port.log"
  local expo_args=(start --host lan --port "$port" --go)

  acquire_slot
  echo "Starting Metro on port $port..."
  # A watcher in the server's session kills the group once .git is gone, so a
  # deleted worktree never leaves Metro behind. Poll .git, never the root:
  # Metro recreates paths under its root, and .git is a file in a linked
  # worktree and a directory in a primary checkout.
  # shellcheck disable=SC2016
  local watcher='if [ -e "$1/.git" ]; then
    ( while [ -e "$1/.git" ] && kill -0 $$; do sleep "$2"; done; kill -TERM 0 ) &
  else
    echo "dev-mobile: no .git under $1, this server will not stop itself." >&2
  fi
  ( sleep "$3"; kill -TERM -- -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 10; kill -KILL -- -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
  shift 3
  exec "$@"'
  local launcher=(
    bash -c "$watcher" _ "$root" 60 "$server_ttl" "$root/node_modules/.bin/expo" "${expo_args[@]}"
  )
  setsid env REACT_NATIVE_PACKAGER_HOSTNAME="$host" EXPO_NO_TELEMETRY=1 \
    "${launcher[@]}" 8>&- 9>&- >"$log" 2>&1 </dev/null &
  local pid=$!
  printf '%s\n' "$pid" >"$ports_dir/$port/pid.$$.tmp"
  mv "$ports_dir/$port/pid.$$.tmp" "$ports_dir/$port/pid"

  local manifest="$cache_dir/manifest-$port.json" bundle_url
  local ready=0
  for _ in {1..120}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      tail -n 20 "$log" >&2 || true
      die "Metro exited. See $log."
    fi
    if curl -fsS -m 2 -H 'expo-platform: android' -H 'accept: application/expo+json' \
      "http://127.0.0.1:$port/" -o "$manifest" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ $ready -eq 1 ]] || {
    tail -n 20 "$log" >&2 || true
    kill_server "$pid"
    die "Metro did not become ready. See $log."
  }

  local host_uri
  host_uri="$(
    node -e 'const m=require(process.argv[1]);process.stdout.write(m.extra?.expoClient?.hostUri||"")' \
      "$manifest" 2>/dev/null || true
  )"
  if [[ $host_uri != "$host:$port" ]]; then
    tail -n 20 "$log" >&2 || true
    kill_server "$pid"
    die "Metro advertises '$host_uri', expected '$host:$port'. Check --host."
  fi

  bundle_url="$(
    node -e 'const m=require(process.argv[1]);process.stdout.write(m.launchAsset?.url||"")' \
      "$manifest" 2>/dev/null || true
  )"
  [[ -n $bundle_url ]] || {
    kill_server "$pid"
    die "Manifest has no bundle URL."
  }
  echo "Checking the Android bundle..."
  if ! curl -fsS -m 180 --resolve "$host:$port:127.0.0.1" -o /dev/null "$bundle_url"; then
    tail -n 20 "$log" >&2 || true
    kill_server "$pid"
    die "The Android bundle failed. See $log."
  fi

  local url="exp://$host:$port"

  local branch
  branch="$(git branch --show-current || true)"
  write_state "$pid" "$port" "$host" "$url" "$branch" "$root" "$log"
  reserved_port=""
  release_worktree_lock

  echo
  echo "Open in Expo Go: $url"
  echo "Branch: ${branch:-detached}"
  echo "Log: $log"
}

case "$cmd" in
  start)
    start_server "$@"
    ;;
  status)
    if [[ ! -f $state ]]; then
      echo "No server saved for this worktree."
      exit 1
    fi
    # shellcheck disable=SC1090
    source "$state"
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "Not running (stale state for port $PORT)."
      exit 1
    fi
    if ! curl -fsS -m 2 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1; then
      echo "Process $PID is alive but Metro is not responding on port $PORT."
      echo "Log: $LOG"
      exit 1
    fi
    echo "Running on port $PORT."
    echo "Link: $URL"
    echo "Branch: ${BRANCH:-detached}"
    echo "Log: $LOG"
    ;;
  rebuild)
    build_dist 1
    echo "Reload the app to pick up the new bundles."
    ;;
esac
