// Linked into the module with --post-js (web/build.sh). With Emscripten 6.0.13 it runs inside the
// module factory after the runtime is up, just before the factory returns. It replaces the raw
// functions of web/pricer_wasm.cpp with price, impliedVol and monteCarlo, and removes the raw ones
// (web/test.mjs fails if this did not happen).
//
// Each public function takes one plain object of named numbers and never throws. Every argument is
// checked here, in JavaScript, before anything enters WebAssembly: the call's shape, each field's
// type (a number, not a string or a Number object: nothing is coerced), finiteness, range and, for
// paths and seed, a whole number. A refusal is returned as {ok: false, error, message}, the shape of
// the C++ side's refusals. Only numbers in range, read once from the argument, are passed on, so no
// page code (a getter, a proxy) runs while WebAssembly is on the stack.
{
  const raw = { price: Module['_price'], impliedVol: Module['_impliedVol'], monteCarlo: Module['_monteCarlo'] };
  for (const name of ['_price', '_impliedVol', '_monteCarlo']) delete Module[name];

  // Inclusive ranges. Vol and rate are percentages; expiry is the time to expiry in years. Zero and
  // negative spots, strikes, vols and expiries are refused. The top vol is the implied-vol solver's
  // bracket. Rates are floored at -10% so that e^{-rT}, which multiplies the strike, stays below
  // e^{10} at the longest expiry: the price's rounding error is about 1e-16 of S + K e^{-rT}.
  // Paths bound the work: Monte Carlo's time is proportional to them, and 2,000,000 paths took under
  // 0.2 s on an Apple M1 Pro (web/test.mjs times the largest call), so a laptop several times slower
  // stays near a second. Seeds are whole numbers a JavaScript number holds exactly.
  const LIMITS = {
    spot: [0.01, 1e6],
    strike: [0.01, 1e6],
    expiry: [1e-4, 100],
    vol: [0.01, 1000],
    rate: [-10, 100],
    paths: [2, 2e6],
    seed: [0, 2 ** 53 - 1],
  };
  const WHOLE = new Set(['paths', 'seed']);

  const refuse = (error, message) => ({ ok: false, error, message });
  const describe = (x) =>
    typeof x === 'string' ? JSON.stringify(x)
      : typeof x === 'bigint' ? `${x}n`
      : x === null ? 'null'
      : Array.isArray(x) ? 'an array'
      : typeof x === 'object' ? 'an object'
      : typeof x === 'function' ? 'a function'
      : String(x);

  // The call's one argument, checked; an array of the values in the order of names, or a refusal.
  function read(fn, args, names) {
    if (args.length !== 1) return refuse('expected_one_object', `${fn}: expected one object argument, got ${args.length} arguments`);
    const a = args[0];
    if (typeof a !== 'object' || a === null || Array.isArray(a))
      return refuse('expected_one_object', `${fn}: expected an object of named arguments, got ${describe(a)}`);
    const values = [];
    try {
      for (const k of Object.keys(a))
        if (!names.includes(k)) return refuse('unknown_argument', `${fn}: unknown argument ${JSON.stringify(k)}; the arguments are ${names.join(', ')}`);
      for (const k of names) {
        if (!Object.prototype.hasOwnProperty.call(a, k)) return refuse('missing_argument', `${fn}: missing argument ${k}`);
        values.push(a[k]);
      }
    } catch {
      return refuse('unreadable_argument', `${fn}: reading the argument threw`);
    }
    for (const [i, k] of names.entries()) {
      const x = values[i];
      if (k === 'type') {
        if (x !== 'call' && x !== 'put') return refuse('unknown_type', `${fn}: type must be 'call' or 'put', got ${describe(x)}`);
        continue;
      }
      if (typeof x !== 'number') return refuse('not_a_number', `${fn}: ${k} must be a number, got ${describe(x)}`);
      if (!Number.isFinite(x)) return refuse('not_finite', `${fn}: ${k} must be finite, got ${x}`);
      if (WHOLE.has(k) && !Number.isInteger(x)) return refuse('not_an_integer', `${fn}: ${k} must be a whole number, got ${x}`);
      const range = LIMITS[k];
      if (range && !(x >= range[0] && x <= range[1])) return refuse('out_of_range', `${fn}: ${k} must be from ${range[0]} to ${range[1]}, got ${x}`);
    }
    return values;
  }

  const PRICE = ['type', 'spot', 'strike', 'expiry', 'vol', 'rate'];
  const IMPLIED_VOL = ['price', 'spot', 'strike', 'expiry', 'rate'];
  const MONTE_CARLO = ['type', 'spot', 'strike', 'expiry', 'vol', 'rate', 'paths', 'seed'];

  // {type, spot, strike, expiry, vol, rate} -> {ok: true, price, delta, gamma, vega, theta}
  Module['price'] = function price(...args) {
    const v = read('price', args, PRICE);
    return Array.isArray(v) ? raw.price(v[0] === 'call', v[1], v[2], v[3], v[4], v[5]) : v;
  };
  // {price, spot, strike, expiry, rate}, a call's price -> {ok: true, vol, iterations}; the price
  // itself is checked by the solver (below_lower_bound, above_upper_bound)
  Module['impliedVol'] = function impliedVol(...args) {
    const v = read('impliedVol', args, IMPLIED_VOL);
    return Array.isArray(v) ? raw.impliedVol(v[0], v[1], v[2], v[3], v[4]) : v;
  };
  // {type, spot, strike, expiry, vol, rate, paths, seed} -> {ok: true, price, stdError, ciLow, ciHigh, closedForm}
  Module['monteCarlo'] = function monteCarlo(...args) {
    const v = read('monteCarlo', args, MONTE_CARLO);
    return Array.isArray(v) ? raw.monteCarlo(v[0] === 'call', v[1], v[2], v[3], v[4], v[5], v[6], v[7]) : v;
  };
  Module['limits'] = Object.freeze(Object.fromEntries(Object.entries(LIMITS).map(([k, [min, max]]) => [k, Object.freeze({ min, max })])));
}
