// Tests of the WebAssembly module (web/dist, from web/build.sh), with Node built-ins only. All but
// section 6 run against the release module itself; section 6 needs the hooks that only the test
// module (build/wasm-test/pricer_test.mjs: the release sources plus web/test_hooks.cpp) has.
// 0. the build and the module's shape: SHA256SUMS and the sizes in BUILD.txt match the files; the
//    public functions and limits, no raw functions, no test hooks;
// 1. known answers: Hull's textbook values, put-call parity, the no-arbitrage bounds and limiting cases;
// 2. agreement with the native build (web/driver.cpp, through the library directly) on the parameter
//    grid of tests/grid.hpp and on two seeded random samples (one over the whole allowed range, one
//    near the money), call and put, price and every Greek; negative prices, by rounding, counted;
// 3. implied volatility: round trips over the same points, agreement with the native solver, and its
//    refusals;
// 4. Monte Carlo: seeded results against the native build's, repeatability, pinned results, the
//    estimate against the closed form, the standard error against the number of paths, and how the
//    estimate fails as vol x sqrt(T) grows (reported, not asserted beyond vol x sqrt(T) = 2);
// 5. every refusal by name: wrong types, missing and extra arguments, NaN, infinities, negatives,
//    zero, values beyond the limits; the limits themselves accepted, with finite results at every
//    corner of the allowed ranges;
// 6. 100,000 refused calls of each kind on both modules, then the stack pointer and the memory size
//    (test module) and the results (both) as before; internal errors forced through the test hook;
// 7. the time of the largest Monte Carlo call the limits allow, for the usual option and the slowest
//    case found, each in a fresh Node process.
//
// Usage, from the repository root: node web/test.mjs [path/to/web_driver]
// TIME_LIMIT_SECONDS overrides section 7's bound (0.5 s; 2 s when CI is set).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createModule from './dist/pricer.mjs';
import createTestModule from '../build/wasm-test/pricer_test.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const driver = process.argv[2] ?? `${ROOT}build/web_driver`;

let failures = 0;
let checks = 0;
const check = (ok, message) => {
  checks++;
  if (!ok && ++failures <= 30) console.error(`FAIL: ${message}`);
};
const M = await createModule(); // the release module
const T = await createTestModule(); // the test module

// 0. the module's shape
const LIMITS = {
  spot: { min: 0.01, max: 1e6 }, strike: { min: 0.01, max: 1e6 }, expiry: { min: 1e-4, max: 100 }, vol: { min: 0.01, max: 1000 },
  rate: { min: -10, max: 100 }, paths: { min: 1000, max: 2e6 }, seed: { min: 0, max: 2 ** 53 - 1 }, reliableVolRootT: 1.25,
};
{
  for (const name of ['_price', '_impliedVol', '_monteCarlo', 'stackPointer', 'heapSize', 'uncheckedMonteCarlo'])
    check(!(name in M), `the release module must not have ${name}`);
  for (const name of ['_price', '_impliedVol', '_monteCarlo']) check(!(name in T), `web/post.js did not remove ${name}`);
  for (const name of ['price', 'impliedVol', 'monteCarlo']) check(typeof M[name] === 'function', `the module has no function ${name}`);
  check(JSON.stringify(M.limits) === JSON.stringify(LIMITS), `limits ${JSON.stringify(M.limits)}`);
  check(Object.isFrozen(M.limits) && Object.values(M.limits).every(Object.isFrozen), 'limits are not frozen');
  const mc = M.monteCarlo({ type: 'call', spot: 100, strike: 100, expiry: 1, vol: 20, rate: 3, paths: 1000, seed: 1 });
  check(Object.keys(mc).join() === 'ok,price,stdError,ciLow,ciHigh,closedForm,volRootT,reliable', `Monte Carlo fields ${Object.keys(mc)}`);
  const dist = `${ROOT}web/dist/`;
  const sums = readFileSync(`${dist}SHA256SUMS`, 'utf8').trim().split('\n').map((line) => line.split(/ +/));
  check(sums.map(([, f]) => f).join() === 'pricer.mjs,pricer.wasm,BUILD.txt', `SHA256SUMS lists ${sums.map(([, f]) => f)}`);
  for (const [sum, f] of sums) check(createHash('sha256').update(readFileSync(dist + f)).digest('hex') === sum, `${f} does not match SHA256SUMS`);
  const build = readFileSync(`${dist}BUILD.txt`, 'utf8');
  for (const f of ['pricer.mjs', 'pricer.wasm'])
    check(build.includes(`${f}: ${readFileSync(dist + f).length} bytes`), `BUILD.txt does not give the size of ${f}`);
  check(/^emcc .* 6\.0\.13 /.test(build) && /^source commit: [0-9a-f]{40}/m.test(build), `BUILD.txt: ${build}`);
}

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
const without = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
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
  let negative = 0, mostNegative = 0;
  cases.forEach((c, i) => {
    const w = M.price(c), s = scales(c);
    // The library's price can be below zero by rounding (at most 1e-12 of its scale); the module
    // clamps it at 0, so never returns a negative price.
    const nativePrice = fromBits(rows[i][1]);
    if (nativePrice < 0) {
      negative++;
      mostNegative = Math.min(mostNegative, nativePrice / s[0]);
      check(nativePrice >= -1e-12 * s[0], `${label}: native price ${nativePrice} ${JSON.stringify(c)}`);
    }
    check(w.price >= 0, `${label}: negative price ${JSON.stringify(c)}: ${w.price}`);
    OUTPUTS.forEach((k, j) => {
      const n = fromBits(rows[i][j + 1]);
      if (Object.is(w[k], n)) stats[j].identical++;
      const d = Math.abs(w[k] - n) / s[j];
      stats[j].worst = Math.max(stats[j].worst, d);
      check(d <= 1e-12, `${label}: ${k} ${JSON.stringify(c)}: WebAssembly ${w[k]}, native ${n}`);
    });
  });
  console.log(`native agreement, ${label} (${cases.length} cases): ` +
    OUTPUTS.map((k, j) => `${k} ${stats[j].identical} bit-identical, worst ${stats[j].worst.toExponential(2)}`).join('; ') + ' (tolerance 1e-12 of scale); ' +
    `${negative} native prices below zero (the most negative ${mostNegative.toExponential(2)} of S + K e^{-rT}), none from the module`);
}
// Seeded samples: spot, strike, expiry and vol log-uniform and rate uniform over the allowed ranges;
// and near the money, strike log-uniform from 1 to 10^4, spot within a factor 2 of it, expiry from a
// day to 10 years, vol 5% to 200%, rate -5% to 15%. Calls and puts alternate.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261118);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logUniform = (lo, hi) => clamp(Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo))), lo, hi);
const SAMPLE = 20000;
const wide = Array.from({ length: SAMPLE }, (_, i) => ({
  type: i % 2 ? 'put' : 'call', spot: logUniform(LIMITS.spot.min, LIMITS.spot.max), strike: logUniform(LIMITS.strike.min, LIMITS.strike.max),
  expiry: logUniform(LIMITS.expiry.min, LIMITS.expiry.max), vol: logUniform(LIMITS.vol.min, LIMITS.vol.max),
  rate: LIMITS.rate.min + rnd() * (LIMITS.rate.max - LIMITS.rate.min),
}));
const nearTheMoney = Array.from({ length: SAMPLE }, (_, i) => {
  const strike = logUniform(1, 1e4);
  return { type: i % 2 ? 'put' : 'call', spot: strike * logUniform(0.5, 2), strike, expiry: logUniform(1 / 365, 10), vol: logUniform(5, 200), rate: -5 + 20 * rnd() };
});
compareClosedForm('grid', gridPoints.flatMap((g) => [{ type: 'call', ...g }, { type: 'put', ...g }]));
compareClosedForm('random over the allowed ranges', wide);
compareClosedForm('random near the money', nearTheMoney);

// 3. implied volatility. A grid point is well conditioned when vega >= 1e-7 x (S + K e^{-rT}) per vol
// point: the price's rounding error, about 1e-16 of that scale, then moves the vol by under 1e-8
// points (for K = 100 this is close to the vega >= 1e-5 of tests/test_pricing.cpp).
const NAMED = { below_lower_bound: 'invalid_argument', above_upper_bound: 'invalid_argument', vol_above_bracket: 'domain_error', not_converged: 'runtime_error' };
function compareImpliedVol(label, points) {
  const cases = points.map((g) => {
    const p = M.price({ ...without(g, 'type'), type: 'call' });
    return { ...without(g, 'type'), price: p.price, well: p.vega >= 1e-7 * (g.spot + discountedStrike(g)) };
  });
  const rows = native(cases.map((c) => `iv ${c.price} ${c.spot} ${c.strike} ${c.expiry} ${c.rate}`));
  let well = 0, worstRoundTrip = 0, worstNative = 0, atBound = 0, maxIterations = 0;
  const outcomes = {};
  cases.forEach((c, i) => {
    const w = M.impliedVol({ price: c.price, spot: c.spot, strike: c.strike, expiry: c.expiry, rate: c.rate }), n = rows[i];
    const outcome = w.ok ? 'ok' : w.error, at = JSON.stringify(c);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    if (w.ok) maxIterations = Math.max(maxIterations, w.iterations);
    // Within 1e-12 of S + K e^{-rT} of the lower bound max(S - K e^{-rT}, 0) (a price at the
    // in-the-money bound, or a tiny one far out of the money) the two builds' rounding decides: one
    // may refuse it, or stop at 100 iterations, where the other solves it.
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
    `outcome as native's everywhere except ${atBound} prices within 1e-12 of S + K e^{-rT} of the lower bound`);
}
compareImpliedVol('grid', gridPoints);
compareImpliedVol('random over the allowed ranges', wide);
compareImpliedVol('random near the money', nearTheMoney);
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
    check(w.closedForm === M.price(without(without(r, 'paths'), 'seed')).price, `Monte Carlo closedForm ${JSON.stringify(r)}`);
    check(w.volRootT === (r.vol / 100) * Math.sqrt(r.expiry) && w.reliable === (w.volRootT <= LIMITS.reliableVolRootT), `Monte Carlo volRootT and reliable ${JSON.stringify(w)}`);
  });
  console.log(`Monte Carlo against native: ${runs.length} seeded runs of 10^6 paths, ${identical} bit-identical in all four outputs, ` +
    `worst relative difference ${worst.toExponential(2)} (tolerance 1e-12)`);

  // Pinned: the WebAssembly module's own result, bit for bit, so that a change of behaviour shows and
  // so that other machines (CI) can be seen to give the same bits
  const pinned = M.monteCarlo({ ...CASES[0], paths: 1e6, seed: 42 });
  const bitsOf = (x) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, x);
    return b.getBigUint64(0).toString(16).padStart(16, '0');
  };
  check(FIELDS.map((k) => bitsOf(pinned[k])).join() === '4022de48166ef0c6,3f8cf65e61c02bf4,4022d0171d1dc5f8,4022ec790fc01b94',
    `pinned Monte Carlo result ${JSON.stringify(pinned)}: ${FIELDS.map((k) => bitsOf(pinned[k])).join()}`);

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
  const series = [1e3, 1e4, 1e5, 1e6].map((paths) => M.monteCarlo({ ...CASES[0], paths, seed: 1 }).stdError);
  check(series.every((s, i) => i === 0 || s < series[i - 1]), `standard error does not fall with paths: ${series}`);
  console.log(`Monte Carlo against the closed form, 10^6 paths, seed 42: z = ${z.join(', ')} (bound 4); standard error ratio for 4x paths ${ratio.toFixed(4)} ` +
    `(0.5 +/- 0.05); standard error at 10^3..10^6 paths, seed 1: ${series.map((s) => s.toPrecision(3)).join(', ')}; ` +
    `pinned result for seed 42 (${pinned.price}, standard error ${pinned.stdError}) bit for bit`);

  // As vol x sqrt(T) grows, the payoff's distribution gets so skewed that the sample misses the rare
  // paths that carry the price, and the standard error, estimated from the same sample, misses them
  // too (bench/mc_coverage.mjs measures it over 1,000 seeds). Call, S = K = 100, r = 3%: coverage of
  // the 95% interval over seeds 1-20 at 10^5 paths, z at 10^6 paths, seed 42, and the result's
  // reliable field, which must be true exactly at or below limits.reliableVolRootT. Coverage and z are
  // asserted only where reliable is true.
  const rows2 = [[20, 1], [100, 1], [100, 4], [200, 4], [300, 5], [1000, 1]].map(([vol, expiry]) => {
    const c = { type: 'call', spot: 100, strike: 100, expiry, vol, rate: 3 };
    let covered = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = M.monteCarlo({ ...c, paths: 1e5, seed });
      covered += r.ciLow <= r.closedForm && r.closedForm <= r.ciHigh;
    }
    const r = M.monteCarlo({ ...c, paths: 1e6, seed: 42 }), width = (vol / 100) * Math.sqrt(expiry);
    const score = (r.price - r.closedForm) / r.stdError;
    check(r.volRootT === width && r.reliable === (width <= LIMITS.reliableVolRootT), `Monte Carlo at vol x sqrt(T) = ${width}: ${JSON.stringify(r)}`);
    if (r.reliable) check(Math.abs(score) <= 4 && covered >= 15, `Monte Carlo at vol x sqrt(T) = ${width}: z = ${score}, covered ${covered} of 20`);
    return `${width.toFixed(1)}: ${covered}/20 covered, estimate ${r.price.toPrecision(5)} +/- ${r.stdError.toPrecision(3)} against ${r.closedForm.toPrecision(5)}, ` +
      `z = ${score.toFixed(2)}, reliable ${r.reliable}`;
  });
  console.log(`Monte Carlo as vol x sqrt(T) grows: ${rows2.join('; ')}`);

  // The standard error is computed in one pass, sum of squares less paths x mean^2 (MCPrice), which
  // cancels when the payoff hardly varies. Deep in the money, the payoff is e^{-rT} (S_T - K), whose
  // standard deviation is exactly S sqrt(e^{vol^2 T} - 1): the reported standard error against that,
  // over 2,000,000 paths (whose own sampling error is about 0.05%). Asserted within 0.5% for vol 20%
  // and T = 1; reported, not asserted, for vol 0.01% and T = 1e-4, where the payoff's standard
  // deviation is 1e-6 of its mean.
  const ratios = [[1e6, 1, 20], [100, 1, 20], [1e6, 1e-4, 0.01], [100, 1e-4, 0.01]].map(([spot, expiry, vol]) => {
    const exact = (spot * Math.sqrt(Math.expm1((vol / 100) ** 2 * expiry))) / Math.sqrt(2e6);
    const got = [1, 2].map((seed) => M.monteCarlo({ type: 'call', spot, strike: 0.01, expiry, vol, rate: 3, paths: 2e6, seed }).stdError / exact);
    if (vol === 20) check(got.every((x) => Math.abs(x - 1) <= 0.005), `standard error against the exact one, S = ${spot}, vol ${vol}%: ${got}`);
    return `S = ${spot}, K = 0.01, T = ${expiry}, vol ${vol}%: ${got.map((x) => x.toFixed(4)).join(' and ')}`;
  });
  console.log(`Monte Carlo standard error over the exact one, 2,000,000 paths, seeds 1 and 2: ${ratios.join('; ')}`);
}

// 5. refusals, by name
const BASE = {
  price: { type: 'call', spot: 100, strike: 100, expiry: 1, vol: 20, rate: 3 },
  impliedVol: { price: 9.4, spot: 100, strike: 100, expiry: 1, rate: 3 },
  monteCarlo: { type: 'call', spot: 100, strike: 100, expiry: 1, vol: 20, rate: 3, paths: 1000, seed: 1 },
};
const isRefusal = (r, error) =>
  r !== null && typeof r === 'object' && Object.keys(r).join() === 'ok,error,message' && r.ok === false && r.error === error &&
  typeof r.message === 'string' && r.message.length > 0;
{
  const NOT_NUMBERS = ['100', '', true, null, undefined, 100n, Symbol('x'), new Number(100), [100], {}, () => 100];
  const NOT_FINITE = [NaN, Infinity, -Infinity];
  let refused = 0;
  // every label starts with the function's name, and so must every refusal's message
  const expect = (label, got, error) => {
    refused++;
    check(isRefusal(got, error) && got.message.startsWith(`${label.match(/^\w+/)[0]}: `),
      `${label}: ${String(JSON.stringify(got))}, expected a refusal ${error} whose message starts with the function's name`);
  };
  for (const [fn, base] of Object.entries(BASE)) {
    const f = M[fn];
    for (const [label, call] of [
      ['()', () => f()],
      ['(base, base)', () => f(base, base)],
      ...[null, undefined, 5, 'x', true, 5n, [], [base], () => base].map((x) => [`(${typeof x} ${Array.isArray(x) ? 'array' : String(x)})`, () => f(x)]),
    ])
      expect(`${fn}${label}`, call(), 'expected_one_object');
    expect(`${fn} with an extra argument`, f({ ...base, volatility: 20 }), 'unknown_argument');
    expect(`${fn} with a misspelt argument`, f({ ...without(base, 'spot'), Spot: 100 }), 'unknown_argument');
    expect(`${fn} with a non-enumerable extra argument`, f(Object.defineProperty({ ...base }, 'volatility', { value: 20 })), 'unknown_argument');
    expect(`${fn} with a symbol-keyed extra argument`, f({ ...base, [Symbol('volatility')]: 20 }), 'unknown_argument');
    for (const k of Object.keys(base)) {
      expect(`${fn} without ${k}`, f(without(base, k)), 'missing_argument');
      expect(`${fn} with ${k} inherited, not its own`, f(Object.assign(Object.create({ [k]: base[k] }), without(base, k))), 'missing_argument');
      if (k === 'type') {
        for (const t of ['CALL', 'Call', 'american', '', ' call', 1, null, undefined, new String('call'), ['call']])
          expect(`${fn} with type ${typeof t} ${String(t)}`, f({ ...base, type: t }), 'unknown_type');
        continue;
      }
      for (const x of NOT_NUMBERS) expect(`${fn} with ${k} ${typeof x}`, f({ ...base, [k]: x }), 'not_a_number');
      for (const x of NOT_FINITE) expect(`${fn} with ${k} ${x}`, f({ ...base, [k]: x }), 'not_finite');
      if (k === 'price') continue; // the solver checks the price: below
      const { min, max } = LIMITS[k];
      const below = k === 'rate' ? [-10.000001, -100, -1e300] : k === 'seed' ? [-1, -(2 ** 53)] : [0, -0, -1, min / 2, -1e300];
      for (const x of [...below, max * 1.000001, max * 2, 1e300].filter((x) => !(k === 'paths' || k === 'seed') || Number.isInteger(x)))
        expect(`${fn} with ${k} ${x}`, f({ ...base, [k]: x }), 'out_of_range');
      if (k === 'paths' || k === 'seed') for (const x of [1.5, 2.000001, 1000.5]) expect(`${fn} with ${k} ${x}`, f({ ...base, [k]: x }), 'not_an_integer');
      // the limits themselves are allowed, with finite results; for the solver, the call price of the
      // same inputs at vol 20%, which it solves or refuses by name
      for (const x of [min, max]) {
        const args = { ...base, [k]: x };
        if (fn === 'impliedVol') args.price = M.price({ ...without(args, 'price'), type: 'call', vol: 20 }).price;
        const r = f(args);
        check(fn === 'impliedVol' && !r.ok ? Object.keys(NAMED).includes(r.error)
          : r.ok === true && Object.values(r).every((v) => typeof v === 'boolean' || Number.isFinite(v)), `${fn} with ${k} at its limit ${x}: ${JSON.stringify(r)}`);
      }
    }
    // reading the argument runs page code: a throwing getter or proxy is refused, not propagated
    const getter = Object.defineProperty({ ...without(base, 'spot') }, 'spot', { enumerable: true, get() { throw new Error('no'); } });
    expect(`${fn} with a throwing getter`, f(getter), 'unreadable_argument');
    const proxy = new Proxy(base, { ownKeys() { throw new Error('no'); } });
    expect(`${fn} with a throwing proxy`, f(proxy), 'unreadable_argument');
    // a revoked proxy throws on every operation but typeof, Array.isArray included
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(`${fn}(revoked proxy)`, f(revoked), 'unreadable_argument');
    for (const k of Object.keys(base)) expect(`${fn} with ${k} a revoked proxy`, f({ ...base, [k]: revoked }), k === 'type' ? 'unknown_type' : 'not_a_number');
    // a message echoes at most 20 characters of a caller's string, and nothing of a BigInt or a symbol
    const long = 'x'.repeat(1e6);
    for (const [label, args, error] of [
      ['a long string', { ...base, strike: long }, 'not_a_number'],
      ['a long key', { ...base, [long]: 1 }, 'unknown_argument'],
      ['a long type', { ...base, ...(fn === 'impliedVol' ? { price: long } : { type: long }) }, fn === 'impliedVol' ? 'not_a_number' : 'unknown_type'],
      ['a huge BigInt', { ...base, strike: 2n ** 100000n }, 'not_a_number'],
      ['a long symbol', { ...base, strike: Symbol(long) }, 'not_a_number'],
    ]) {
      const r = f(args);
      expect(`${fn} with ${label}`, r, error);
      check(r.message.length <= 160, `${fn} with ${label}: a message of ${r.message.length} characters`);
    }
    // accepted: an object without a prototype, and arguments in any order
    check(f(Object.assign(Object.create(null), base)).ok === true, `${fn} with a prototype-less object`);
    check(JSON.stringify(f(Object.fromEntries(Object.entries(base).reverse()))) === JSON.stringify(f(base)), `${fn} with its arguments in another order`);
  }
  // the solver's refusals, by the price
  for (const [label, price, error] of [['0', 0, 'below_lower_bound'], ['-1', -1, 'below_lower_bound'], ['-1e300', -1e300, 'below_lower_bound'],
    ['the spot', 100, 'above_upper_bound'], ['1e300', 1e300, 'above_upper_bound']])
    expect(`impliedVol with price ${label}`, M.impliedVol({ ...BASE.impliedVol, price }), error);

  // every corner of the allowed ranges, call and put: finite prices and Greeks, a solver that solves
  // or names its refusal, finite Monte Carlo results
  let corners = 0;
  const ends = (k) => [LIMITS[k].min, LIMITS[k].max];
  for (const type of ['call', 'put']) for (const spot of ends('spot')) for (const strike of ends('strike')) for (const expiry of ends('expiry'))
    for (const vol of ends('vol')) for (const rate of ends('rate')) {
      const c = { type, spot, strike, expiry, vol, rate }, at = JSON.stringify(c);
      const p = M.price(c);
      check(p.ok && OUTPUTS.every((k) => Number.isFinite(p[k])), `corner ${at}: ${JSON.stringify(p)}`);
      const iv = M.impliedVol({ price: p.price, spot, strike, expiry, rate });
      check(iv.ok ? Number.isFinite(iv.vol) : Object.keys(NAMED).includes(iv.error), `corner ${at}: implied vol ${JSON.stringify(iv)}`);
      const mc = M.monteCarlo({ ...c, paths: 1000, seed: 1 });
      check(mc.ok && ['price', 'stdError', 'ciLow', 'ciHigh', 'closedForm', 'volRootT'].every((k) => Number.isFinite(mc[k])) && typeof mc.reliable === 'boolean',
        `corner ${at}: Monte Carlo ${JSON.stringify(mc)}`);
      corners++;
    }
  console.log(`refusals: ${refused} refused calls, each with its named reason; each limit accepted with finite results; ` +
    `${corners} corners of the allowed ranges (call and put): finite prices, Greeks and Monte Carlo results, implied vol solved or refused by name`);
}

// 6. 100,000 refused calls of each kind on both modules. Most are refused in JavaScript; the solver's
// refusals and the forced internal errors are C++ exceptions thrown and caught inside WebAssembly.
// On the test module the stack pointer and the memory size must not have changed; on both, the
// results computed before must come out the same afterwards.
{
  const N = 100000;
  const throwing = Object.defineProperty({ ...without(BASE.price, 'spot') }, 'spot', { enumerable: true, get() { throw new Error('no'); } });
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  const KINDS = [
    ['expected_one_object', (X, i) => X.price(...[[], [null], [5], [BASE.price, BASE.price]][i % 4])],
    ['unknown_argument', (X) => X.price({ ...BASE.price, volatility: 20 })],
    ['missing_argument', (X) => X.monteCarlo(without(BASE.monteCarlo, 'seed'))],
    ['not_a_number', (X, i) => X.price({ ...BASE.price, spot: ['100', null, undefined, 100n][i % 4] })],
    ['not_finite', (X, i) => X.impliedVol({ ...BASE.impliedVol, price: [NaN, Infinity, -Infinity][i % 3] })],
    ['out_of_range', (X, i) => X.monteCarlo({ ...BASE.monteCarlo, ...[{ spot: -1 }, { vol: 0 }, { paths: 2e6 + 1 }, { rate: -11 }][i % 4] })],
    ['not_an_integer', (X) => X.monteCarlo({ ...BASE.monteCarlo, seed: 0.5 })],
    ['unknown_type', (X) => X.price({ ...BASE.price, type: 'CALL' })],
    ['unreadable_argument', (X, i) => X.price(i % 2 ? throwing : revoked)],
    ['below_lower_bound', (X) => X.impliedVol({ ...BASE.impliedVol, price: -1 })],
    ['above_upper_bound', (X) => X.impliedVol({ ...BASE.impliedVol, price: 100 })],
    ['vol_above_bracket', (X) => X.impliedVol({ price: 99.99999, spot: 100, strike: 100, expiry: 1, rate: 0 })],
  ];
  const reference = (X) => JSON.stringify([X.price(BASE.price), X.impliedVol(BASE.impliedVol), X.monteCarlo(BASE.monteCarlo)]);
  const refuseMany = (X) => {
    const counts = {};
    for (const [error, call] of KINDS) {
      let n = 0;
      for (let i = 0; i < N; i++) n += isRefusal(call(X, i), error);
      counts[error] = n;
    }
    return counts;
  };
  const before = [reference(M), reference(T)], sp = T.stackPointer(), heap = T.heapSize();
  const t = refuseMany(T);
  // the library throws inside a bound call: MCPrice refuses fewer than 2 paths
  let internal = 0;
  for (let i = 0; i < N; i++) {
    const r = T.uncheckedMonteCarlo(true, 100, 100, 1, 20, 3, i % 3 === 0 ? 1 : -i, 1);
    internal += isRefusal(r, 'internal_error') && r.message.startsWith('monteCarlo: ');
  }
  t.internal_error = internal;
  const spAfter = T.stackPointer(), heapAfter = T.heapSize();
  const m = refuseMany(M);
  for (const [name, counts] of [['test', t], ['release', m]])
    for (const [error, n] of Object.entries(counts)) check(n === N, `${name} module: ${n} of ${N} ${error} refusals as expected`);
  check(spAfter === sp, `the test module's stack pointer moved from ${sp} to ${spAfter}`);
  check(heapAfter === heap, `the test module's memory grew from ${heap} to ${heapAfter} bytes`);
  check(reference(M) === before[0] && reference(T) === before[1], 'results changed after the refused calls');
  const forced = T.uncheckedMonteCarlo(true, 100, 100, 1, 20, 3, 1, 1);
  console.log(`refusals in a loop: ${N.toLocaleString('en-GB')} each of ${KINDS.length} kinds on both modules, and ${N.toLocaleString('en-GB')} forced internal errors ` +
    `on the test module (${JSON.stringify(forced)}); stack pointer ${sp} before, ${spAfter} after; memory ${heap} bytes before, ${heapAfter} after; ` +
    'price, implied vol and Monte Carlo results unchanged on both');
}

// 7. the largest Monte Carlo call the limits allow, each case first in a fresh process (before the
// engine has optimised the code) and then twice more: the usual option, and the slowest case found,
// where most terminal spots are subnormal numbers, which the exponential is slow to produce
{
  const bound = Number(process.env.TIME_LIMIT_SECONDS ?? (process.env.CI ? 2 : 0.5));
  const CASES = [
    ['S = K = 100, T = 1, vol 20%, r 3%', { spot: 100, strike: 100, expiry: 1, vol: 20, rate: 3 }],
    ['S = K = 0.01, T = 100, vol 375%, r -10%', { spot: 0.01, strike: 0.01, expiry: 100, vol: 375, rate: -10 }],
  ];
  const lines = CASES.map(([label, c]) => {
    const script = `const M = await (await import(${JSON.stringify(`${ROOT}web/dist/pricer.mjs`)})).default();
const times = [];
for (let seed = 1; seed <= 3; seed++) {
  const t = performance.now();
  const r = M.monteCarlo({ type: 'call', ...${JSON.stringify(c)}, paths: M.limits.paths.max, seed });
  times.push((performance.now() - t) / 1000);
  if (!r.ok) throw new Error(JSON.stringify(r));
}
console.log(JSON.stringify(times));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    const times = r.status === 0 ? JSON.parse(r.stdout) : [];
    check(times.length === 3 && Math.max(...times) <= bound, `the largest Monte Carlo call, ${label}: ${r.stdout}${r.stderr} (bound ${bound} s)`);
    return `${label}: ${times.map((s) => s.toFixed(3)).join(', ')} s`;
  });
  console.log(`timing: Monte Carlo at the limit of ${LIMITS.paths.max.toLocaleString('en-GB')} paths, first call in a fresh process, then two more: ` +
    `${lines.join('; ')} (bound ${bound} s)`);
}

if (failures) {
  console.error(`FAIL: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS: ${checks} checks`);
