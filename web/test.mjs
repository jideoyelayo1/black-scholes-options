// Tests of the WebAssembly module (web/dist, from web/build.sh), with Node built-ins only.
// 1. known answers: Hull's textbook values, put-call parity, the no-arbitrage bounds and limiting cases;
// 2. agreement with the native build (web/driver.cpp, through the library directly) on the parameter
//    grid of tests/grid.hpp, call and put, price and every Greek;
// 3. implied volatility: round trips over the grid, agreement with the native solver, and its refusals;
// 4. Monte Carlo: seeded results against the native build's, repeatability, the estimate against the
//    closed form, and the standard error against the number of paths.
//
// Usage, from the repository root: node web/test.mjs [path/to/web_driver]

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createModule from './dist/pricer.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const driver = process.argv[2] ?? `${ROOT}build/web_driver`;

let failures = 0;
let checks = 0;
const check = (ok, message) => {
  checks++;
  if (!ok && ++failures <= 30) console.error(`FAIL: ${message}`);
};
const M = await createModule();

// tests/grid.hpp, read rather than copied: K = 100, 7 spots, 5 expiries, 6 vols, 3 rates
const grid = Object.fromEntries(
  [...readFileSync(`${ROOT}tests/grid.hpp`, 'utf8').matchAll(/constexpr double (k\w+)(?:\[\])? = \{?([^};]+)\}?;/g)].map(([, name, list]) => [
    name,
    list.split(',').map((x) => x.split('/').map(Number).reduce((a, b) => a / b)),
  ]),
);
const gridPoints = [];
for (const spot of grid.kSpots) for (const expiry of grid.kExpiries) for (const vol of grid.kVols) for (const rate of grid.kRates)
  gridPoints.push({ spot, strike: grid.kStrike[0], expiry, vol, rate });

// The native driver: one request per line, each double returned as its bit pattern in hex.
function native(requests) {
  const r = spawnSync(driver, [], { input: requests.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) {
    console.error(`native driver ${driver} failed:`, r.error?.message ?? r.stderr);
    process.exit(1);
  }
  return r.stdout.trimEnd().split('\n').map((line) => line.split(' '));
}
const fromBits = (h) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setBigUint64(0, BigInt(`0x${h}`));
  return b.getFloat64(0);
};
const discountedStrike = (c) => c.strike * Math.exp((-c.rate / 100) * c.expiry);
const near = (got, want, rtol, atol) => Math.abs(got - want) <= rtol * Math.abs(want) + atol; // NaN is never near

// 1. known answers
{
  const call = (spot, strike, expiry, vol, rate) => M.price({ type: 'call', spot, strike, expiry, vol, rate });
  const put = (spot, strike, expiry, vol, rate) => M.price({ type: 'put', spot, strike, expiry, vol, rate });
  // Hull, Options, Futures, and Other Derivatives: S=42, K=40, r=10%, vol=20%, T=0.5 gives c=4.76, p=0.81.
  check(near(call(42, 40, 0.5, 20, 10).price, 4.76, 0, 0.005), 'Hull call 4.76');
  check(near(put(42, 40, 0.5, 20, 10).price, 0.81, 0, 0.005), 'Hull put 0.81');
  // Hull's 20-week example: S=49, K=50, r=5%, vol=20%, T=20/52: price 2.40, delta 0.522, gamma 0.066,
  // vega 12.1 per unit vol (0.121 per vol point), theta -4.31 per year (-0.0118 per calendar day).
  const h = call(49, 50, 20 / 52, 20, 5);
  check(near(h.price, 2.4, 0, 0.005) && near(h.delta, 0.522, 0, 0.0005) && near(h.gamma, 0.066, 0, 0.0005) &&
    near(h.vega, 0.121, 0, 0.0005) && near(h.theta, -0.0118, 0, 0.00005), `Hull 20-week call ${JSON.stringify(h)}`);
  // S=K=100, r=5%, vol=20%, T=1: c=10.4506, p=5.5735 (4 d.p.).
  check(near(call(100, 100, 1, 20, 5).price, 10.4506, 0, 5e-5) && near(put(100, 100, 1, 20, 5).price, 5.5735, 0, 5e-5), 'S=K=100 call and put');

  // Over the grid: put-call parity C - P = S - K e^{-rT} to 1e-10 of the strike, delta parity to 1e-12,
  // the same gamma and vega for the call and the put, and the no-arbitrage bounds with 1e-12 x K slack
  // (the tolerances of tests/test_pricing.cpp).
  let worstParity = 0;
  for (const g of gridPoints) {
    const c = call(g.spot, g.strike, g.expiry, g.vol, g.rate), p = put(g.spot, g.strike, g.expiry, g.vol, g.rate);
    const fwd = g.spot - discountedStrike(g), slack = 1e-12 * g.strike, at = JSON.stringify(g);
    worstParity = Math.max(worstParity, Math.abs(c.price - p.price - fwd));
    check(Math.abs(c.price - p.price - fwd) <= 1e-10 * g.strike, `parity ${at}`);
    check(Math.abs(c.delta - p.delta - 1) <= 1e-12, `delta parity ${at}`);
    check(c.gamma === p.gamma && c.vega === p.vega, `call and put gamma and vega ${at}`);
    check(c.price >= Math.max(fwd, 0) - slack && c.price <= g.spot + slack, `call bounds ${at}`);
    check(p.price >= Math.max(-fwd, 0) - slack && p.price <= discountedStrike(g) + slack, `put bounds ${at}`);
  }
  // Limits: deep in and out of the money; the call tends to S as vol x sqrt(T) grows; at the money with
  // r = 0 and a short expiry the call is S vol sqrt(T) / sqrt(2 pi) to first order (Brenner and
  // Subrahmanyam, 1988), with a relative error of about (vol sqrt(T))^2 / 24, under 1e-6 here.
  check(near(call(1000, 100, 1, 20, 3).price, 1000 - 100 * Math.exp(-0.03), 1e-14, 0), 'deep ITM call');
  check(near(put(10, 100, 1, 20, 3).price, 100 * Math.exp(-0.03) - 10, 1e-14, 0), 'deep ITM put');
  check(Math.abs(call(10, 100, 1, 20, 3).price) < 1e-20 && Math.abs(put(1000, 100, 1, 20, 3).price) < 1e-20, 'deep OTM call and put');
  check(near(call(100, 100, 100, 1000, 3).price, 100, 1e-12, 0), 'call at vol 1000%, 100 years');
  check(near(call(100, 100, 1e-4, 20, 0).price, (100 * 0.2 * Math.sqrt(1e-4)) / Math.sqrt(2 * Math.PI), 1e-6, 0), 'short-expiry call at the money');
  console.log(`known answers: Hull's values; over the ${gridPoints.length}-point grid, put-call parity (worst residual ${worstParity.toExponential(3)}), ` +
    'delta parity, equal call and put gamma and vega, no-arbitrage bounds; deep in and out of the money, high vol, short expiry');
}

// 2. agreement with the native build, call and put over the grid. The two builds use different maths
// libraries (Apple's and Emscripten's musl), and the native arm64 build fuses multiplies and adds, so
// results can differ in the last bits. Tolerance: 1e-12 of the size of the terms each formula
// combines: S + K e^{-rT} for the price, 1 for delta, 1 / (S vol sqrt(T)) for gamma, S sqrt(T) / 100
// for vega, (S vol / sqrt(T) + |r| K e^{-rT}) / 365 for theta (vol and r as fractions here).
const OUTPUTS = ['price', 'delta', 'gamma', 'vega', 'theta'];
const scales = (c) => {
  const v = c.vol / 100, sd = v * Math.sqrt(c.expiry), dk = discountedStrike(c);
  return [c.spot + dk, 1, 1 / (c.spot * sd), (c.spot * Math.sqrt(c.expiry)) / 100, ((c.spot * v) / Math.sqrt(c.expiry) + (Math.abs(c.rate) / 100) * dk) / 365];
};
function compareClosedForm(label, cases) {
  const rows = native(cases.map((c) => `bs ${c.type} ${c.spot} ${c.strike} ${c.expiry} ${c.vol} ${c.rate}`));
  const stats = OUTPUTS.map(() => ({ identical: 0, worst: 0 }));
  cases.forEach((c, i) => {
    const w = M.price(c), s = scales(c);
    OUTPUTS.forEach((k, j) => {
      const n = fromBits(rows[i][j + 1]);
      if (Object.is(w[k], n)) stats[j].identical++;
      const d = Math.abs(w[k] - n) / s[j];
      stats[j].worst = Math.max(stats[j].worst, d);
      check(d <= 1e-12, `${label}: ${k} ${JSON.stringify(c)}: WebAssembly ${w[k]}, native ${n}`);
    });
  });
  console.log(`native agreement, ${label} (${cases.length} cases): ` +
    OUTPUTS.map((k, j) => `${k} ${stats[j].identical} bit-identical, worst ${stats[j].worst.toExponential(2)}`).join('; ') + ' (tolerance 1e-12 of scale)');
}
compareClosedForm('grid', gridPoints.flatMap((g) => [{ type: 'call', ...g }, { type: 'put', ...g }]));

// 3. implied volatility. A grid point is well conditioned when vega >= 1e-7 x (S + K e^{-rT}) per vol
// point: the price's rounding error, about 1e-16 of that scale, then moves the vol by under 1e-8
// points (for K = 100 this is close to the vega >= 1e-5 of tests/test_pricing.cpp).
const NAMED = { below_lower_bound: 'invalid_argument', above_upper_bound: 'invalid_argument', vol_above_bracket: 'domain_error', not_converged: 'runtime_error' };
function compareImpliedVol(label, points) {
  const cases = points.map((g) => {
    const p = M.price({ type: 'call', ...g });
    return { ...g, price: p.price, well: p.vega >= 1e-7 * (g.spot + discountedStrike(g)) };
  });
  const rows = native(cases.map((c) => `iv ${c.price} ${c.spot} ${c.strike} ${c.expiry} ${c.rate}`));
  let well = 0, worstRoundTrip = 0, worstNative = 0, atBound = 0, maxIterations = 0;
  const outcomes = {};
  cases.forEach((c, i) => {
    const w = M.impliedVol({ price: c.price, spot: c.spot, strike: c.strike, expiry: c.expiry, rate: c.rate }), n = rows[i];
    const outcome = w.ok ? 'ok' : w.error, at = JSON.stringify(c);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    if (w.ok) maxIterations = Math.max(maxIterations, w.iterations);
    // the two builds' lower bounds max(S - K e^{-rT}, 0) can differ by rounding, so a price within
    // rounding of it may be refused by one and solved by the other
    const lower = Math.max(c.spot - discountedStrike(c), 0);
    const same = w.ok ? n[0] === 'ok' : n[0] === 'throw' && n[1] === NAMED[w.error];
    if (!same && Math.abs(c.price - lower) <= 1e-12 * (c.spot + discountedStrike(c))) atBound++;
    else check(same, `${label}: implied vol outcome ${at}: WebAssembly ${JSON.stringify(w)}, native ${n.join(' ')}`);
    if (!c.well) return;
    well++;
    check(w.ok && Math.abs(w.vol - c.vol) <= 1e-6, `${label}: implied vol round trip ${at}: ${JSON.stringify(w)}`);
    worstRoundTrip = Math.max(worstRoundTrip, Math.abs(w.vol - c.vol));
    if (w.ok && n[0] === 'ok') {
      const d = Math.abs(w.vol - fromBits(n[1]));
      worstNative = Math.max(worstNative, d);
      check(d <= 1e-7, `${label}: implied vol against native ${at}: ${w.vol}, native ${fromBits(n[1])}`);
    }
  });
  console.log(`implied vol, ${label} (${cases.length} call prices): outcomes ${JSON.stringify(outcomes)}, at most ${maxIterations} iterations; ` +
    `${well} well conditioned: worst round-trip error ${worstRoundTrip.toExponential(2)} vol points (tolerance 1e-6), ` +
    `worst difference from native ${worstNative.toExponential(2)} (tolerance 1e-7); ` +
    `outcome as native's everywhere except ${atBound} prices within 1e-12 of the lower bound`);
}
compareImpliedVol('grid', gridPoints);
{
  const iv = (price, spot = 120, strike = 100, expiry = 1, rate = 3) => M.impliedVol({ price, spot, strike, expiry, rate });
  const lower = 120 - 100 * Math.exp(-0.03);
  for (const [label, got, want] of [
    ['at about the lower bound', iv(lower).error, 'below_lower_bound'],
    ['under the lower bound', iv(lower - 1).error, 'below_lower_bound'],
    ['zero, out of the money', iv(0, 80).error, 'below_lower_bound'],
    ['negative', iv(-1, 80).error, 'below_lower_bound'],
    ['equal to the spot', iv(120).error, 'above_upper_bound'],
    ['above the spot', iv(1e300).error, 'above_upper_bound'],
    // a call at vol 1000% for one year, S = K = 100, r = 0, is worth 100 (cdf(5) - cdf(-5)) = 99.99994
    ['implying a vol above 1000%', iv(99.99999, 100, 100, 1, 0).error, 'vol_above_bracket'],
  ])
    check(got === want, `implied vol ${label}: ${got}, expected ${want}`);
  const r = iv(99.99999, 100, 100, 1, 0);
  check(Object.keys(r).join() === 'ok,error,message' && typeof r.message === 'string' && r.message.length > 0, `refusal shape ${JSON.stringify(r)}`);
  check(native(['iv 99.99999 100 100 1 0'])[0].join(' ') === 'throw domain_error', 'native solver: vol above 1000%');
}

// 4. Monte Carlo
{
  const CASES = [
    { type: 'call', spot: 100, strike: 100, expiry: 1, vol: 20, rate: 3 },
    { type: 'put', spot: 100, strike: 100, expiry: 1, vol: 20, rate: 3 },
    { type: 'call', spot: 80, strike: 100, expiry: 0.25, vol: 30, rate: 5 },
    { type: 'put', spot: 120, strike: 100, expiry: 2, vol: 50, rate: 0 },
    { type: 'call', spot: 150, strike: 100, expiry: 7 / 365, vol: 20, rate: 3 },
  ];
  const FIELDS = ['price', 'stdError', 'ciLow', 'ciHigh'];
  // Seeded runs against the native build's. Both use libc++'s std::normal_distribution (the same
  // algorithm, Marsaglia's polar method) on std::mt19937_64, so the paths are the same up to the
  // maths libraries' rounding: tolerance 1e-12, relative.
  const runs = [];
  for (const seed of [1, 2, 42, 2 ** 53 - 1]) for (const c of CASES) runs.push({ ...c, paths: 1e6, seed });
  const rows = native(runs.map((r) => `mc ${r.type} ${r.spot} ${r.strike} ${r.expiry} ${r.vol} ${r.rate} ${r.paths} ${r.seed}`));
  let identical = 0, worst = 0;
  runs.forEach((r, i) => {
    const w = M.monteCarlo(r), n = rows[i].slice(1).map(fromBits);
    identical += FIELDS.every((k, j) => Object.is(w[k], n[j]));
    const d = Math.max(...FIELDS.map((k, j) => Math.abs(w[k] - n[j]) / Math.abs(n[j])));
    worst = Math.max(worst, d);
    check(d <= 1e-12, `Monte Carlo against native ${JSON.stringify(r)}: ${JSON.stringify(w)}, native ${n.join(' ')}`);
    check(w.closedForm === M.price(r).price, `Monte Carlo closedForm ${JSON.stringify(r)}`);
  });
  console.log(`Monte Carlo against native: ${runs.length} seeded runs of 10^6 paths, ${identical} bit-identical in all four outputs, ` +
    `worst relative difference ${worst.toExponential(2)} (tolerance 1e-12)`);

  // Same seed, same result; another seed, another result.
  const a = M.monteCarlo({ ...CASES[0], paths: 10000, seed: 1 }), b = M.monteCarlo({ ...CASES[0], paths: 10000, seed: 1 });
  check(JSON.stringify(a) === JSON.stringify(b) && Object.is(a.price, b.price), 'same seed, same result');
  check(a.price !== M.monteCarlo({ ...CASES[0], paths: 10000, seed: 2 }).price, 'seeds 1 and 2 gave the same price');
  check(a.ciLow === a.price - 1.959963984540054 * a.stdError && a.ciHigh === a.price + 1.959963984540054 * a.stdError, '95% interval');

  // Within 4 standard errors of the closed form at 10^6 paths, seed 42 (a correct pricer fails one
  // such check with probability 6e-5), as tests/test_mc.cpp.
  const z = CASES.map((c) => {
    const r = M.monteCarlo({ ...c, paths: 1e6, seed: 42 });
    const score = (r.price - r.closedForm) / r.stdError;
    check(Math.abs(score) <= 4, `Monte Carlo ${JSON.stringify(c)}: z = ${score}`);
    return score.toFixed(2);
  });
  // Standard error falls as 1/sqrt(paths): four times the paths, half the error (within 10%).
  const ratio = M.monteCarlo({ ...CASES[0], paths: 400000, seed: 7 }).stdError / M.monteCarlo({ ...CASES[0], paths: 100000, seed: 7 }).stdError;
  check(Math.abs(ratio - 0.5) <= 0.05, `standard error ratio ${ratio}`);
  const series = [1e2, 1e3, 1e4, 1e5, 1e6].map((paths) => M.monteCarlo({ ...CASES[0], paths, seed: 1 }).stdError);
  check(series.every((s, i) => i === 0 || s < series[i - 1]), `standard error does not fall with paths: ${series}`);
  console.log(`Monte Carlo against the closed form, 10^6 paths, seed 42: z = ${z.join(', ')} (bound 4); standard error ratio for 4x paths ${ratio.toFixed(4)} ` +
    `(0.5 +/- 0.05); standard error at 10^2..10^6 paths, seed 1: ${series.map((s) => s.toPrecision(3)).join(', ')}`);
}

if (failures) {
  console.error(`FAIL: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS: ${checks} checks`);
