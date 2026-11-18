#!/usr/bin/env bash
# The native tests, the WebAssembly build and its tests, into bench/raw/web_tests.txt. From the
# repository root, with em++ on PATH (emsdk: source emsdk_env.sh) and node. Paths in the output are
# shown relative to the repository: its absolute path is stripped. If any build or test fails, the
# script stops there, says so and exits non-zero; the file then ends with the failing step's output.
set -euo pipefail
root=$(pwd)
out=bench/raw/web_tests.txt
mkdir -p bench/raw
trap 'echo "error: a build or a test failed; its output is at the end of $out" >&2' ERR

{
  echo "# commit $(git rev-parse --short HEAD)$(git status --porcelain --untracked-files=no -- . ':(exclude)bench/raw' | grep -q . && echo ' (dirty)' || true), $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(uname -sr), $(c++ --version | head -n 1), cmake $(cmake --version | head -n 1 | cut -d ' ' -f 3), node $(node --version)"
  echo "# bench/web_tests.sh; paths are shown relative to the repository"
  echo "# load average before: $(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"
  echo "# cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build && ctest --test-dir build --output-on-failure"
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build build >/dev/null
  ctest --test-dir build --output-on-failure 2>&1 | sed -n '/Test #/p;/tests passed/p;/tests failed/,$p'
  for t in test_pricing test_mc; do echo "# ./build/$t"; ./build/$t; done
  echo "# web/build.sh"
  web/build.sh 2>&1
  echo "# node web/test.mjs build/web_driver"
  node web/test.mjs build/web_driver 2>&1
  echo "# load average after: $(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"
  echo "# web/dist/SHA256SUMS"
  cat web/dist/SHA256SUMS
} | sed -e "s|$root/||g" -e "s|$root|.|g" > "$out"
# a second check, on the file itself: both summaries must be there
grep -q '^100% tests passed' "$out" && grep -q '^PASS' "$out" || { echo "error: the native or the WebAssembly tests did not pass; see $out" >&2; exit 1; }
echo "wrote $out"
