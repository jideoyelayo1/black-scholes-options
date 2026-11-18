// Linked into the module with --post-js (web/build.sh). With Emscripten 6.0.13 it runs inside the
// module factory after the runtime is up, just before the factory returns. It replaces the raw
// functions of web/pricer_wasm.cpp with price, impliedVol and monteCarlo, and removes the raw ones
// (web/test.mjs fails if this did not happen). Options passed to the factory (onRuntimeInitialized,
// preRun) run before this does and could reach the raw ones, so the README says to pass none.
//
// Each public function takes one plain object of named numbers and never throws. Every argument is
// checked here, in JavaScript, before anything enters WebAssembly: the call's shape, each field's
// type (a number, not a string or a Number object: nothing is coerced), finiteness, range and, for
// paths and seed, a whole number. A refusal is returned as {ok: false, error, message}, the shape of
// the C++ side's refusals. Only numbers in range, read once from the argument, are passed on, so no
// page code (a getter, a proxy) runs while WebAssembly is on the stack. Everything that touches the
// caller's values runs inside one try: anything that throws there (a getter, a proxy's trap, a
// revoked proxy, which even Array.isArray throws on) is the refusal unreadable_argument.
{
  const raw = { price: Module['_price'], impliedVol: Module['_impliedVol'], monteCarlo: Module['_monteCarlo'] };
  for (const name of ['_price', '_impliedVol', '_monteCarlo']) delete Module[name];

  // Inclusive ranges. Vol and rate are percentages; expiry is the time to expiry in years. Zero and
  // negative spots, strikes, vols and expiries are refused. The top vol is the implied-vol solver's
  // bracket. Rates are floored at -10% so that e^{-rT}, which multiplies the strike, stays below
  // e^{10} at the longest expiry: the price's rounding error is about 1e-16 of S + K e^{-rT}.
  // The fewest paths is 1,000, not the library's 2: below it the 95% interval does not hold even for
  // a modest vol x sqrt(T) (bench/raw/mc_coverage.txt: 0.929 at 100 paths and vol x sqrt(T) = 0.5),
  // so the reliable field below could not mean anything there.
  // Paths bound the work: Monte Carlo's time is proportional to them. web/test.mjs times the largest
  // call for the usual option and for the slowest case found (terminal spots so small that the
  // exponential returns subnormal numbers, slowly); the README gives the times and the reasoning.
  // Seeds are whole numbers a JavaScript number holds exactly.
  const LIMITS = {
    spot: [0.01, 1e6],
    strike: [0.01, 1e6],
    expiry: [1e-4, 100],
    vol: [0.01, 1000],
    rate: [-10, 100],
    paths: [1000, 2e6],
    seed: [0, 2 ** 53 - 1],
  };
  const WHOLE = new Set(['paths', 'seed']);
  // Monte Carlo's 95% interval can be trusted only while vol x sqrt(T) is small: beyond that a call's
  // payoff is so skewed that the sample misses the rare paths that carry its price, and the standard
  // error, estimated from the same sample, misses them too. bench/mc_coverage.mjs measured the
  // interval's coverage over 1,000 seeds at 100 to 2,000,000 paths; this is the largest vol x sqrt(T)
  // it tried at which coverage was consistent with 95% at every path count, and at every smaller one
  // (bench/raw/mc_coverage.txt): at 1.5 it was 0.923 at 1,000 paths. Measured on a call: a put's
  // payoff is bounded by the strike, so the field is cautious for puts.
  const RELIABLE_VOL_ROOT_T = 1.25;

  const refuse = (error, message) => ({ ok: false, error, message });
  // A caller's value, for a message: only its type is looked at (typeof cannot throw), and at most 20
  // characters of a string are echoed, so a message stays short whatever the value.
  const describe = (x) =>
    typeof x === 'string' ? JSON.stringify(x.length > 20 ? `${x.slice(0, 20)}...` : x)
      : typeof x === 'number' || typeof x === 'boolean' || x === undefined ? String(x)
      : x === null ? 'null'
      : typeof x === 'object' ? 'an object'
      : typeof x === 'function' ? 'a function'
      : `a ${typeof x}`;

  // The call's one argument, checked; an array of the values in the order of names, or a refusal.
  function read(fn, args, names) {
    try {
      return check(fn, args, names);
    } catch {
      return refuse('unreadable_argument', `${fn}: reading the argument threw`);
    }
  }
  function check(fn, args, names) {
    if (args.length !== 1) return refuse('expected_one_object', `${fn}: expected one object argument, got ${args.length} arguments`);
    const a = args[0];
    if (typeof a !== 'object' || a === null || Array.isArray(a))
      return refuse('expected_one_object', `${fn}: expected an object of named arguments, got ${describe(a)}`);
    const values = [];
    // every own key, non-enumerable and symbol keys included, must be one of names
    for (const k of Reflect.ownKeys(a))
      if (!names.includes(k)) return refuse('unknown_argument', `${fn}: unknown argument ${describe(k)}; the arguments are ${names.join(', ')}`);
    for (const k of names) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) return refuse('missing_argument', `${fn}: missing argument ${k}`);
      values.push(a[k]);
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

  // Checks the call, then runs it on the checked values. The raw functions take only numbers and
  // return refusals rather than throw; the catch keeps the promise that nothing throws even if the
  // module's own JavaScript did.
  function run(fn, args, names, call) {
    const v = read(fn, args, names);
    if (!Array.isArray(v)) return v;
    try {
      return call(v);
    } catch {
      return refuse('internal_error', `${fn}: an exception in the module's JavaScript`);
    }
  }

  const PRICE = ['type', 'spot', 'strike', 'expiry', 'vol', 'rate'];
  const IMPLIED_VOL = ['price', 'spot', 'strike', 'expiry', 'rate'];
  const MONTE_CARLO = ['type', 'spot', 'strike', 'expiry', 'vol', 'rate', 'paths', 'seed'];

  // {type, spot, strike, expiry, vol, rate} -> {ok: true, price, delta, gamma, vega, theta}
  Module['price'] = function price(...args) {
    return run('price', args, PRICE, (v) => raw.price(v[0] === 'call', v[1], v[2], v[3], v[4], v[5]));
  };
  // {price, spot, strike, expiry, rate}, a call's price -> {ok: true, vol, iterations}; the price
  // itself is checked by the solver (below_lower_bound, above_upper_bound)
  Module['impliedVol'] = function impliedVol(...args) {
    return run('impliedVol', args, IMPLIED_VOL, (v) => raw.impliedVol(v[0], v[1], v[2], v[3], v[4]));
  };
  // {type, spot, strike, expiry, vol, rate, paths, seed}
  //   -> {ok: true, price, stdError, ciLow, ciHigh, closedForm, volRootT, reliable}
  Module['monteCarlo'] = function monteCarlo(...args) {
    return run('monteCarlo', args, MONTE_CARLO, (v) => {
      const r = raw.monteCarlo(v[0] === 'call', v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
      if (r.ok) {
        r.volRootT = (v[4] / 100) * Math.sqrt(v[3]);
        r.reliable = r.volRootT <= RELIABLE_VOL_ROOT_T;
      }
      return r;
    });
  };
  Module['limits'] = Object.freeze({
    ...Object.fromEntries(Object.entries(LIMITS).map(([k, [min, max]]) => [k, Object.freeze({ min, max })])),
    reliableVolRootT: RELIABLE_VOL_ROOT_T,
  });
}
