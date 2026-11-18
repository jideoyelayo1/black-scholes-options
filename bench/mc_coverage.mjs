// How often Monte Carlo's 95% interval contains the closed form, by vol x sqrt(T) and paths, through
// the WebAssembly module's own monteCarlo (web/dist, from web/build.sh). It chose the threshold of
// the reliable field: the largest vol x sqrt(T) tested at which, at every path count tested that the
// limits allow (limits.paths.min and up), the coverage's 95% interval (normal approximation to a
// binomial over the seeds, as in bench/RESULTS.md) contains 0.95, and at every smaller one too. The
// 100-path column is below the minimum: it is shown, and it is why the minimum is 1,000. The module
// refuses it, so it comes from the test module's unchecked call (build/wasm-test, web/build.sh), the
// same C++ function without post.js's checks.
// A call, S = K = 100, r = 3%, T = 1 year, so that vol x sqrt(T) is vol / 100; seeds 1 to 1000 at
// each path count (a longer run with the same seed extends the shorter one's stream, as in the study).
// The results depend only on the module, not on the machine. About 20 minutes on an Apple M1 Pro.
//
// Usage, from the repository root: node bench/mc_coverage.mjs > bench/raw/mc_coverage.txt
import { readFileSync } from 'node:fs';
import createModule from '../web/dist/pricer.mjs';
import createTestModule from '../build/wasm-test/pricer_test.mjs';

const M = await createModule();
const T = await createTestModule();
const call = (vol, paths, seed) =>
  paths >= M.limits.paths.min
    ? M.monteCarlo({ type: 'call', spot: 100, strike: 100, expiry: 1, vol, rate: 3, paths, seed })
    : T.uncheckedMonteCarlo(true, 100, 100, 1, vol, 3, paths, seed);
const WIDTHS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const PATHS = [1e2, 1e3, 1e4, 1e5, 1e6, 2e6];
const SEEDS = 1000;
const Z = 1.959963984540054;

const build = readFileSync(new URL('../web/dist/BUILD.txt', import.meta.url), 'utf8').split('\n');
console.log(`# node bench/mc_coverage.mjs; the module of ${build[0]}, ${build[1]}`);
console.log(`# call, S = K = 100, r = 3%, T = 1; seeds 1-${SEEDS} at each path count; coverage of the 95% interval, ` +
  'with its own 95% interval (normal approximation); * where that interval does not contain 0.95; ' +
  `columns below limits.paths.min (${M.limits.paths.min.toLocaleString('en-GB')}) are shown but do not count towards the threshold`);
console.log(['vol x sqrt(T)', ...PATHS.map((p) => `${p.toLocaleString('en-GB')} paths`)].join('\t'));
let threshold = 0;
let allPassSoFar = true;
for (const width of WIDTHS) {
  const cells = [];
  let pass = true;
  for (const paths of PATHS) {
    let covered = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = call(width * 100, paths, seed);
      if (!r.ok) throw new Error(JSON.stringify(r));
      covered += r.ciLow <= r.closedForm && r.closedForm <= r.ciHigh;
    }
    const p = covered / SEEDS, half = Z * Math.sqrt((p * (1 - p)) / SEEDS);
    const ok = Math.abs(p - 0.95) <= half;
    pass &&= ok || paths < M.limits.paths.min;
    cells.push(`${p.toFixed(3)} (${(p - half).toFixed(3)} to ${(p + half).toFixed(3)})${ok ? '' : ' *'}`);
  }
  allPassSoFar &&= pass;
  if (allPassSoFar) threshold = width;
  console.log([width, ...cells].join('\t'));
}
console.log(`threshold: ${threshold} (the largest vol x sqrt(T) tested at which coverage is consistent with 0.95 at every allowed path count tested, ` +
  'and at every smaller one)');
