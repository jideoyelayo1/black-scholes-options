#!/usr/bin/env bash
# Checks bench/web_tests.sh's failure paths at HEAD: a CMake configure error and an em++ compile
# error must each make it exit non-zero, leave bench/raw/web_tests.txt byte for byte as it was, keep
# the run's output, the error included, in build/web_tests.failed.txt, and show there no absolute
# path of the checkout, emsdk or the home directory. Each failure is made in a temporary worktree of
# HEAD, so this checkout is not touched. From the repository root, with em++ on PATH (emsdk_env.sh)
# and node; about a minute.
set -euo pipefail
tmp=$(mktemp -d)
wt=$tmp/wt
trap 'git worktree remove --force "$wt" 2>/dev/null || true; rm -rf "$tmp"' EXIT
failures=0
fail() { echo "FAIL $1"; failures=$((failures + 1)); }

# label, a command that breaks the worktree, a line the failed output must contain
check() {
  git worktree add -q --detach "$wt" HEAD
  (cd "$wt" && eval "$2")
  local before after f=$wt/build/web_tests.failed.txt
  before=$(shasum -a 256 < "$wt/bench/raw/web_tests.txt")
  if (cd "$wt" && bench/web_tests.sh) > /dev/null 2> "$tmp/stderr"; then fail "$1: bench/web_tests.sh exited 0"; fi
  after=$(shasum -a 256 < "$wt/bench/raw/web_tests.txt")
  [ "$before" = "$after" ] || fail "$1: bench/raw/web_tests.txt changed"
  grep -q 'is unchanged' "$tmp/stderr" || fail "$1: no error message from bench/web_tests.sh"
  if [ -f "$f" ]; then
    grep -q "$3" "$f" || fail "$1: the error is not in build/web_tests.failed.txt"
    for dir in "$wt" "$(cd "$wt" && pwd -P)" "${EMSDK:-}" "$HOME"; do
      [ -n "$dir" ] && grep -qF "$dir" "$f" && fail "$1: an absolute path in build/web_tests.failed.txt"
    done
  else
    fail "$1: no build/web_tests.failed.txt"
  fi
  echo "$1: bench/raw/web_tests.txt sha256 ${before%% *} before, ${after%% *} after; first error kept: $( [ -f "$f" ] && grep -m 1 -E 'Error|error:' "$f" | cut -c 1-100)"
  git worktree remove --force "$wt"
}

check 'CMake configure error' 'echo "not_a_command(" >> CMakeLists.txt' 'CMake Error'
check 'em++ compile error' 'printf "\nEMSCRIPTEN_BINDINGS(broken) { emscripten::function(\"broken\", 5); }\n" >> web/pricer_wasm.cpp' 'no matching function'
[ "$failures" = 0 ] && echo "PASS: both failures left bench/raw/web_tests.txt unchanged" || { echo "FAIL: $failures check(s) failed"; exit 1; }
