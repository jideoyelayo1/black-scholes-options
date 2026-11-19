#pragma once

#include <cmath>
#include <cstdint>
#include <random>
#include <stdexcept>


struct MCResult {
    double price;      // discounted mean payoff
    double std_error;  // sample standard deviation of the discounted payoff / sqrt(paths)
    double ci_low;     // 95% confidence interval: price -/+ 1.96 * std_error
    double ci_high;
    std::uint64_t in_the_money;  // paths that finished in the money (a positive payoff)
};

inline MCResult MCPrice(bool call, double spot, double time, double strike, double expiry, double vol, double rate,
                        std::uint64_t paths, std::uint64_t seed) {
    /*
        Monte Carlo price of a European call (call = true) or put under Black-Scholes.

        Samples the terminal spot exactly, S_T = S exp((r - vol^2/2) T + vol sqrt(T) Z), so the
        only error is sampling error. No variance reduction. Same units as BlackScholes.hpp:
        vol and rate as percentages, time and expiry in years.

        Random numbers: std::mt19937_64(seed) and std::normal_distribution<double>. The same seed
        and path count give the same result with the same standard library; a run with more paths
        extends the same stream, so its first paths are those of a shorter run.
    */
    if (paths < 2) throw std::invalid_argument("Need at least 2 paths for a standard error");
    vol /= 100;
    rate /= 100;
    const double tau = expiry - time, drift = (rate - vol * vol / 2) * tau, diffusion = vol * sqrt(tau);
    const double discount = exp(-rate * tau);

    std::mt19937_64 rng(seed);
    // shortcut: normal_distribution's algorithm is implementation-defined, so libc++ and libstdc++ give
    // different paths for one seed; write the transform by hand if runs must match across standard libraries.
    std::normal_distribution<double> normal;
    double sum = 0, sum_sq = 0;
    std::uint64_t in_the_money = 0;  // counted on the payoff before discounting, which cannot underflow it
    for (std::uint64_t i = 0; i < paths; ++i) {
        const double terminal = spot * exp(drift + diffusion * normal(rng));
        const double intrinsic = fmax(call ? terminal - strike : strike - terminal, 0.0);
        in_the_money += intrinsic > 0;
        const double payoff = discount * intrinsic;
        sum += payoff;
        sum_sq += payoff * payoff;
    }
    const double n = static_cast<double>(paths), mean = sum / n;
    const double std_error = sqrt(fmax(sum_sq - n * mean * mean, 0.0) / (n - 1) / n);
    return {mean, std_error, mean - 1.959963984540054 * std_error, mean + 1.959963984540054 * std_error, in_the_money};
}
