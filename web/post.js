// Linked into the module with --post-js (web/build.sh). With Emscripten 6.0.13 it runs inside the
// module factory after the runtime is up, just before the factory returns. It replaces the raw
// functions of web/pricer_wasm.cpp with price, impliedVol and monteCarlo, which take one object of
// named numbers, and removes the raw ones from the module.
{
  const raw = { price: Module['_price'], impliedVol: Module['_impliedVol'], monteCarlo: Module['_monteCarlo'] };
  for (const name of ['_price', '_impliedVol', '_monteCarlo']) delete Module[name];

  Module['price'] = (a) => raw.price(a.type === 'call', a.spot, a.strike, a.expiry, a.vol, a.rate);
  Module['impliedVol'] = (a) => raw.impliedVol(a.price, a.spot, a.strike, a.expiry, a.rate);
  Module['monteCarlo'] = (a) => raw.monteCarlo(a.type === 'call', a.spot, a.strike, a.expiry, a.vol, a.rate, a.paths, a.seed);
}
