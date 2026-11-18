#!/usr/bin/env bash
# Builds the WebAssembly module into web/dist/: pricer.mjs (ES module factory) and pricer.wasm, plus
# BUILD.txt (Emscripten version, source commit, command, file sizes) and SHA256SUMS. Also builds the
# test module, build/wasm-test/pricer_test.mjs: the same plus web/test_hooks.cpp, for web/test.mjs
# only; it is not released.
# Needs em++ on PATH (emsdk: source emsdk_env.sh). It calls em++ directly: C++17 as in CMakeLists.txt,
# -O2, single-threaded, no filesystem, an ES module for browsers and Node.
# SOURCE_COMMIT, if set, is the commit BUILD.txt names (CI passes a pull request's head: GitHub builds
# a temporary merge of it into the base branch).
set -euo pipefail
cd "$(dirname "$0")/.."

# the previous build goes first, so that a failed build cannot leave stale files
rm -rf web/dist build/wasm-test
mkdir -p web/dist build/wasm-test
version=$(em++ --version | head -n 1)
echo "$version"

flags=(-std=c++17 -O2 -fexceptions -I . -lembind -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH
       -sFILESYSTEM=0 --post-js web/post.js)
em++ "${flags[@]}" web/pricer_wasm.cpp -o web/dist/pricer.mjs
em++ "${flags[@]}" web/pricer_wasm.cpp web/test_hooks.cpp -o build/wasm-test/pricer_test.mjs

built=$(git rev-parse HEAD)
commit=${SOURCE_COMMIT:-$built}
[ "$commit" != "$built" ] && commit="$commit (built as $built: for a pull request, GitHub's merge of it into the base branch)"
git status --porcelain -- '*.hpp' '*.cpp' web | grep -q . && commit="$commit (dirty: the sources differ from it)"
size() { printf '%s: %s bytes (gzip -9: %s bytes)\n' "$1" "$(wc -c < "web/dist/$1" | tr -d ' ')" "$(gzip -9 -c "web/dist/$1" | wc -c | tr -d ' ')"; }
{
    echo "$version"
    echo "source commit: $commit"
    echo "command: em++ ${flags[*]} web/pricer_wasm.cpp -o web/dist/pricer.mjs"
    size pricer.mjs
    size pricer.wasm
} > web/dist/BUILD.txt
(cd web/dist && shasum -a 256 pricer.mjs pricer.wasm BUILD.txt > SHA256SUMS)
cat web/dist/BUILD.txt
