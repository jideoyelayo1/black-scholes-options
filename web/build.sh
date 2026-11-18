#!/usr/bin/env bash
# Builds the WebAssembly module into web/dist/: pricer.mjs (ES module factory) and pricer.wasm.
# Needs em++ on PATH (emsdk: source emsdk_env.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf web/dist
mkdir -p web/dist
em++ --version | head -n 1

flags=(-std=c++17 -O2 -fexceptions -I . -lembind -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH
       -sFILESYSTEM=0 --post-js web/post.js)
em++ "${flags[@]}" web/pricer_wasm.cpp -o web/dist/pricer.mjs
