#!/usr/bin/env bash
# Builds the WebAssembly module into web/dist/: pricer.mjs (ES module factory) and pricer.wasm. Also
# builds the test module, build/wasm-test/pricer_test.mjs: the same plus web/test_hooks.cpp, for
# web/test.mjs only; it is not released.
# Needs em++ on PATH (emsdk: source emsdk_env.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf web/dist build/wasm-test
mkdir -p web/dist build/wasm-test
em++ --version | head -n 1

flags=(-std=c++17 -O2 -fexceptions -I . -lembind -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH
       -sFILESYSTEM=0 --post-js web/post.js)
em++ "${flags[@]}" web/pricer_wasm.cpp -o web/dist/pricer.mjs
em++ "${flags[@]}" web/pricer_wasm.cpp web/test_hooks.cpp -o build/wasm-test/pricer_test.mjs
