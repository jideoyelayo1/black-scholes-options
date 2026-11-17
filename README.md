# README

## Overview

Header-only C++17 tools for pricing European options under the Black-Scholes model: closed-form prices and Greeks, an `Option` class, an implied-volatility solver and a seeded Monte Carlo pricer that reports its standard error and 95% interval. Constant rate, no dividends, no early exercise.

The tests and the study in `bench/` check each method against an independent one: the Greeks against finite differences of the price, the solver by round trip, the Monte Carlo price against the closed form, and put-call parity directly. Results, method and the defects the audit found are in [bench/RESULTS.md](bench/RESULTS.md).

## Files

- **BlackScholes.hpp**: `BSCall`, `BSPut` and the delta, gamma, vega and theta of each.
- **options.hpp** / **options.cpp**: the `Option` class (strike, expiry, `"call"` or `"put"`), which dispatches to the functions above.
- **ImpliedVol.hpp**: `implied_vol`, the implied volatility of a call price.
- **MonteCarlo.hpp**: `MCPrice`, the Monte Carlo price with its standard error and 95% interval.
- **NormalDistribution.hpp** / **NormalDistribution.cpp**: normal pdf and cdf.
- **main.cpp**: a minimal program that builds an `Option`.
- **tests/**: `test_pricing.cpp` (prices, Greeks, `Option`, solver), `test_mc.cpp` (Monte Carlo) and `grid.hpp` (the parameter grid).
- **bench/**: the study (`study.cpp`), the scripts that run it and draw the figure, and the committed outputs.

## Conventions

- `vol` and `rate` are percentages: 20 means 20%.
- `time` is the valuation date and `expiry` the expiry date, both in years; the time to expiry is `expiry - time`.
- Vega is per vol point (per 1%); theta is per calendar day (per year / 365).
- At expiry or at zero vol the price is the discounted payoff. The Greeks take their limits there away from the strike; at the strike itself they are undefined and return NaN.
- `implied_vol(price, spot, strike, expiry, rate, &iterations)` takes a call price and a time to expiry. It throws `std::invalid_argument` for a price outside `(max(S - K e^{-rT}, 0), S)`.

## Build and test

Needs CMake 3.16 or later and a C++17 compiler.

```sh
git clone https://github.com/jideoyelayo1/black-scholes-options.git
cd black-scholes-options
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

## The study

```sh
bench/run.sh          # tests, study and figure; about 8 minutes on an Apple M1 Pro
bench/run.sh 100      # the same with 100 seeds per path count instead of 1000
```

`bench/run.sh` writes the test log, the study's CSVs and summary, and `bench/mc_convergence.png`. The figure needs matplotlib, which the script installs with [uv](https://docs.astral.sh/uv/) into `bench/.venv`; the C++ code has no Python dependency.

Results (details, tolerances and method in [bench/RESULTS.md](bench/RESULTS.md)):

- **Closed form.** Put-call parity holds to 2.8e-14 over a 630-point grid of spot, expiry, vol and rate; every Greek agrees with a finite difference of the price within its stated tolerance; reference values from Hull match.
- **Implied vol.** Every grid point with vega >= 1e-5 per vol point round-trips to within 2.9e-10 vol points, in at most 19 iterations (median 5). Below that vega the price barely moves with vol: prices that round to a no-arbitrage bound are rejected, and 39 of the other 69 solve to a vol that reproduces the price but misses the input by more than 1e-6 points.
- **Monte Carlo.** For S = K = 100, vol 20%, r 3%, T = 1 (closed form 9.4134), over 1000 seeds at each of 11 path counts from 10^2 to 10^7: RMS error falls with slope -0.5026 +/- 0.0008 on log-log axes, and the 95% interval covers the closed form in 94.65% of 11,000 runs.

![Monte Carlo estimate with its 95% interval, and error against paths](bench/mc_convergence.png)

## Usage

```cpp
#include "options.hpp"
#include "ImpliedVol.hpp"
#include "MonteCarlo.hpp"

Option call(100, 1, "call");                      // strike 100, expiry 1 year
double price = call.price(100, 0, 20, 3);         // spot 100, today, vol 20%, rate 3%
double delta = call.delta(100, 0, 20, 3);
double vol = implied_vol(price, 100, 100, 1, 3);  // 20
MCResult mc = MCPrice(true, 100, 0, 100, 1, 20, 3, 1000000, 42);  // mc.price, mc.std_error, mc.ci_low, mc.ci_high
```

## Limits

European options under constant rate and volatility only: no dividends, early exercise, stochastic volatility, transaction costs or calibration to market data. The checks show internal consistency, not that the model describes a market. The solver handles calls; a put's implied vol is that of the call with the same strike and expiry, by parity. Seeded Monte Carlo results reproduce with the same standard library; `std::normal_distribution` differs between libc++ and libstdc++.

## License

This project is licensed under the MIT License.

## Contributions

Contributions are welcome! Please fork the repository and submit a pull request for any enhancements or bug fixes.

## Contact

For any questions or issues, please open an issue on GitHub or contact the repository owner.
