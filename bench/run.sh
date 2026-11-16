#!/usr/bin/env bash
# Builds, runs the tests, runs the study and draws the figure. Writes everything into bench/.
# Usage: bench/run.sh [replicates]   (default 1000; about 8 minutes on an Apple M1 Pro)
set -euo pipefail
cd "$(dirname "$0")/.."

{
  uname -sm
  sw_vers -productVersion 2>/dev/null || true
  sysctl -n machdep.cpu.brand_string 2>/dev/null || true
  "${CXX:-c++}" --version | head -1
  cmake --version | head -1
  echo "build: CMAKE_BUILD_TYPE=Release, C++17, flags -O3 -DNDEBUG -Wall -Wextra"
} > bench/environment.txt

cmake -S . -B build -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build build > /dev/null
{ ./build/test_pricing; ./build/test_mc; } | tee bench/test_output.txt
./build/study bench "${1:-1000}" | tee bench/study_output.txt

# The figure needs matplotlib; it lives in a venv local to bench/, not in the C++ build.
if command -v uv > /dev/null; then
  [ -d bench/.venv ] || uv venv -q --python 3.13 bench/.venv
  uv pip install -q --python bench/.venv matplotlib==3.11.2 numpy==2.5.5
  bench/.venv/bin/python -c 'import sys, matplotlib, numpy; print("plot: Python", sys.version.split()[0], "matplotlib", matplotlib.__version__, "numpy", numpy.__version__)' >> bench/environment.txt
  bench/.venv/bin/python bench/plot_convergence.py
else
  echo "uv not found: skipped bench/mc_convergence.png"
fi
