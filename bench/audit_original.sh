#!/usr/bin/env bash
# Runs the current tests/test_pricing.cpp against the headers as they were at 96a6e44, before the
# fixes, and writes bench/audit_original_output.txt. The failures it records are the audit findings
# in bench/RESULTS.md; a non-zero exit is expected.
set -uo pipefail
cd "$(dirname "$0")/.."
old=$(mktemp -d)
for f in BlackScholes.hpp ImpliedVol.hpp NormalDistribution.hpp options.hpp; do git show "96a6e44:$f" > "$old/$f"; done
"${CXX:-c++}" -std=c++17 -O2 -w -I"$old" -Itests tests/test_pricing.cpp -o "$old/test_pricing_original"
"$old/test_pricing_original" > bench/audit_original_output.txt
echo "original headers: exit $?, $(grep -c '^FAIL' bench/audit_original_output.txt) failed checks"
rm -rf "$old"
