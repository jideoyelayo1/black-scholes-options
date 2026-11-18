#!/usr/bin/env bash
# The native tests, the WebAssembly build and its tests, into bench/raw/web_tests.txt. From the
# repository root, with em++ on PATH (emsdk: source emsdk_env.sh) and node.
# Every step's output, stdout and stderr, goes first to build/web_tests.txt. Only when every build
# and test has passed does that file replace bench/raw/web_tests.txt; otherwise the script stops at
# the failing step, keeps the run's output in build/web_tests.failed.txt (build/ is not committed),
# leaves bench/raw/web_tests.txt as it was, says so and exits non-zero. bench/check_web_tests.sh
# checks both failure paths. In the output the repository's absolute path is replaced by ., emsdk's
# by $EMSDK and the home directory by ~.
set -euo pipefail
out=bench/raw/web_tests.txt
tmp=build/web_tests.txt
failed=build/web_tests.failed.txt
mkdir -p build bench/raw
rm -f "$tmp" "$failed"

# the absolute paths to hide, each as given and with symbolic links resolved, the longest first so
# that a path inside another (the repository inside the home directory) is replaced as a whole
hide() {
  [ -n "$1" ] && [ -d "$1" ] || return 0
  printf '%s\t%s\n%s\t%s\n' "$1" "$2" "$(cd "$1" && pwd -P)" "$2"
}
script=$({ hide "$(pwd)" .; hide "${EMSDK:-}" '$EMSDK'; hide "$HOME" '~'; } | awk -F '\t' '{ print length($1) "\t" $0 }' | sort -rn |
  cut -f 2- | while IFS=$'\t' read -r dir to; do printf 's|%s/|%s/|g;s|%s|%s|g;' "$dir" "$to" "$dir" "$to"; done)

set +e
(
  set -euo pipefail
  echo "# commit $(git rev-parse --short HEAD)$(git status --porcelain --untracked-files=no -- . ':(exclude)bench/raw' | grep -q . && echo ' (dirty)' || true), $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(uname -sr), $(c++ --version | head -n 1), cmake $(cmake --version | head -n 1 | cut -d ' ' -f 3), node $(node --version)"
  echo "# bench/web_tests.sh; paths are shown relative to the repository"
  echo "# load average before: $(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"
  echo "# cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --clean-first && ctest --test-dir build --output-on-failure"
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release >/dev/null
  # every native target rebuilt: make compares times to the second, so a header changed within the
  # second of a build could otherwise leave a binary, web_driver once, built from the old header
  cmake --build build --clean-first >/dev/null
  ctest --test-dir build --output-on-failure | sed -n '/Test #/p;/tests passed/p;/tests failed/,$p'
  for t in test_pricing test_mc test_normal; do echo "# ./build/$t"; ./build/$t; done
  echo "# web/build.sh"
  web/build.sh
  echo "# node web/test.mjs build/web_driver"
  node web/test.mjs build/web_driver
  echo "# load average after: $(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"
  echo "# web/dist/SHA256SUMS"
  cat web/dist/SHA256SUMS
) 2>&1 | sed -e "$script" > "$tmp"
status=$(( PIPESTATUS[0] | PIPESTATUS[1] ))
set -e

if [ "$status" -ne 0 ] || ! grep -q '^100% tests passed' "$tmp" || ! grep -q '^PASS' "$tmp"; then
  mv "$tmp" "$failed"
  echo "error: a build or a test failed; $out is unchanged, and this run's output is in $failed" >&2
  exit 1
fi
mv "$tmp" "$out"
echo "wrote $out"
