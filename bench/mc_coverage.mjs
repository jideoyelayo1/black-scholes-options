// How often Monte Carlo's 95% interval contains the closed form, against the two quantities each
// result reports: inTheMoneyPaths, the paths that finished in the money, and volRootT, vol x sqrt(T).
// Through the WebAssembly module's own monteCarlo (web/dist, from web/build.sh).
//
// The grid: calls and puts with S = 100, T = 1, r = 3% (so vol x sqrt(T) is vol / 100), strikes 50,
// 60, 80, 100, 125, 160 and 200 (in, at and out of the money for each type), vols 20% to 150%, and
// 1,000, 10,000 and 100,000 paths, with seeds 1 to 5,000, 2,000 and 500 at those path counts. A
// longer run with the same seed extends the shorter one's stream, as in the study, so the path counts
// are not independent samples. Then the at-the-money call and put with 10,000 seeds at 1,000 paths,
// and, below the floor of 1,000 paths, the at-the-money call at 100 paths through the test module's
// unchecked call (build/wasm-test), the same C++ without post.js's checks.
// Every coverage has its Wilson 95% interval and the number of runs behind it. The results depend
// only on the module, not on the machine.
//
// Usage, from the repository root: node bench/mc_coverage.mjs > bench/raw/mc_coverage.txt
import { readFileSync } from 'node:fs';
import createModule from '../web/dist/pricer.mjs';
import createTestModule from '../build/wasm-test/pricer_test.mjs';

const M = await createModule();
const T = await createTestModule();
const STRIKES = [50, 60, 80, 100, 125, 160, 200];
const VOLS = [20, 50, 75, 100, 125, 150];
const PATHS = [[1e3, 5000], [1e4, 2000], [1e5, 500]];
const ITM_BINS = [0, 1, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000]; // lower edges
const Z = 1.959963984540054;

const wilson = (covered, n) => {
  const p = covered / n, d = 1 + (Z * Z) / n, centre = (p + (Z * Z) / (2 * n)) / d;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { p, lo: centre - half, hi: centre + half, n };
};
const show = ({ p, lo, hi, n }) => `${p.toFixed(3)} (${lo.toFixed(3)} to ${hi.toFixed(3)}, n ${n})`;
const binOf = (count) => ITM_BINS.findLastIndex((edge) => count >= edge);
const binLabel = (i) => (i === ITM_BINS.length - 1 ? `${ITM_BINS[i]}+` : ITM_BINS[i + 1] - 1 === ITM_BINS[i] ? `${ITM_BINS[i]}` : `${ITM_BINS[i]}-${ITM_BINS[i + 1] - 1}`);

const build = readFileSync(new URL('../web/dist/BUILD.txt', import.meta.url), 'utf8').split('\n');
console.log(`# node bench/mc_coverage.mjs; the module of ${build[0]}, ${build[1]}`);
console.log('# coverage of the 95% interval: covered runs / runs, with its Wilson 95% interval and the number of runs n');

// tallies[pathsIndex][bin][vol] = [covered, runs]; cells: one per option and path count
const tallies = PATHS.map(() => ITM_BINS.map(() => Object.fromEntries(VOLS.map((v) => [v, [0, 0]]))));
const cells = [];
console.log('\n## Per option: S = 100, T = 1, r = 3%; inTheMoneyPaths median over the seeds');
console.log(['type', 'strike', 'vol x sqrt(T)', 'paths', 'coverage', 'inTheMoneyPaths median', 'closed form'].join('\t'));
for (const type of ['call', 'put'])
  for (const strike of STRIKES)
    for (const vol of VOLS)
      PATHS.forEach(([paths, seeds], pi) => {
        let covered = 0;
        const counts = [];
        let closedForm;
        for (let seed = 1; seed <= seeds; seed++) {
          const r = M.monteCarlo({ type, spot: 100, strike, expiry: 1, vol, rate: 3, paths, seed });
          if (!r.ok) throw new Error(JSON.stringify(r));
          const hit = r.ciLow <= r.closedForm && r.closedForm <= r.ciHigh;
          covered += hit;
          counts.push(r.inTheMoneyPaths);
          const t = tallies[pi][binOf(r.inTheMoneyPaths)][vol];
          t[0] += hit;
          t[1]++;
          closedForm = r.closedForm;
        }
        counts.sort((a, b) => a - b);
        cells.push({ type, strike, vol, paths, covered, seeds, median: counts[counts.length >> 1] });
        console.log([type, strike, vol / 100, paths, show(wilson(covered, seeds)), counts[counts.length >> 1], closedForm.toPrecision(6)].join('\t'));
      });

for (const [pi, [paths]] of PATHS.entries()) {
  console.log(`\n## Pooled over the options above at ${paths.toLocaleString('en-GB')} paths: by inTheMoneyPaths (rows) and vol x sqrt(T) (columns)`);
  console.log(['inTheMoneyPaths', ...VOLS.map((v) => v / 100), 'all'].join('\t'));
  for (const [b] of ITM_BINS.entries()) {
    const cells = VOLS.map((v) => tallies[pi][b][v]);
    const total = cells.reduce((a, [c, n]) => [a[0] + c, a[1] + n], [0, 0]);
    if (!total[1]) continue;
    console.log([binLabel(b), ...cells.map(([c, n]) => (n ? show(wilson(c, n)) : '-')), show(wilson(...total))].join('\t'));
  }
}

// Runs with at least X paths in the money, pooled over the options; conditioning on the observed count
// selects runs, and a run with fewer paths in the money than usual also tends to underestimate
const THRESHOLDS = [10, 30, 100, 300, 1000, 3000];
for (const [pi, [paths]] of PATHS.entries()) {
  console.log(`\n## Runs with at least X paths in the money, at ${paths.toLocaleString('en-GB')} paths: by X (rows) and vol x sqrt(T) (columns)`);
  console.log(['X', ...VOLS.map((v) => v / 100), 'all'].join('\t'));
  for (const x of THRESHOLDS) {
    const sum = (v) => ITM_BINS.reduce((a, edge, b) => (edge >= x ? [a[0] + tallies[pi][b][v][0], a[1] + tallies[pi][b][v][1]] : a), [0, 0]);
    const byVol = VOLS.map(sum), total = byVol.reduce((a, [c, n]) => [a[0] + c, a[1] + n], [0, 0]);
    if (total[1]) console.log([x, ...byVol.map(([c, n]) => (n ? show(wilson(c, n)) : '-')), show(wilson(...total))].join('\t'));
  }
}

// Per option: the options whose median inTheMoneyPaths is at least X, their lowest and highest coverage
console.log('\n## Options (rows of the first table) whose median inTheMoneyPaths is at least X: lowest and highest coverage, by path count');
console.log(['X', 'paths', 'options', 'lowest', 'highest'].join('\t'));
const label = (c) => `${c.type} K=${c.strike} vol x sqrt(T) ${c.vol / 100}: ${show(wilson(c.covered, c.seeds))}`;
for (const x of THRESHOLDS)
  for (const [paths] of PATHS) {
    const these = cells.filter((c) => c.paths === paths && c.median >= x).sort((a, b) => a.covered / a.seeds - b.covered / b.seeds);
    if (these.length) console.log([x, paths, these.length, label(these[0]), label(these[these.length - 1])].join('\t'));
  }

console.log('\n## At the money (S = K = 100, T = 1, r = 3%), seeds 1 to 10,000 at 1,000 paths');
console.log(['type', 'vol x sqrt(T)', 'coverage', 'inTheMoneyPaths median'].join('\t'));
for (const type of ['call', 'put'])
  for (const vol of [25, 50, 75, 100, 125, 150]) {
    let covered = 0;
    const counts = [];
    for (let seed = 1; seed <= 10000; seed++) {
      const r = M.monteCarlo({ type, spot: 100, strike: 100, expiry: 1, vol, rate: 3, paths: 1000, seed });
      covered += r.ciLow <= r.closedForm && r.closedForm <= r.ciHigh;
      counts.push(r.inTheMoneyPaths);
    }
    counts.sort((a, b) => a - b);
    console.log([type, vol / 100, show(wilson(covered, 10000)), counts[5000]].join('\t'));
  }

console.log('\n## Below the floor: the at-the-money call at 100 paths, seeds 1 to 10,000 (test module, unchecked)');
console.log(['vol x sqrt(T)', 'coverage'].join('\t'));
for (const vol of [25, 50, 100]) {
  let covered = 0;
  for (let seed = 1; seed <= 10000; seed++) {
    const r = T.uncheckedMonteCarlo(true, 100, 100, 1, vol, 3, 100, seed);
    covered += r.ciLow <= r.closedForm && r.closedForm <= r.ciHigh;
  }
  console.log([vol / 100, show(wilson(covered, 10000))].join('\t'));
}
