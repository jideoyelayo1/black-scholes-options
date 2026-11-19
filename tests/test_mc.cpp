// Checks for the Monte Carlo pricer. Seeds are fixed, so every check is deterministic.
// The convergence and coverage study is bench/study.cpp; these are the unit checks.
#include <cmath>
#include <cstdio>
#include <stdexcept>

#include "BlackScholes.hpp"
#include "MonteCarlo.hpp"
#include "NormalDistribution.hpp"

static int checks = 0, failures = 0;
#define CHECK(cond, ...)                                                   \
    do {                                                                   \
        ++checks;                                                          \
        if (!(cond)) {                                                     \
            ++failures;                                                    \
            std::printf("FAIL line %d: ", __LINE__);                       \
            std::printf(__VA_ARGS__);                                      \
            std::printf("\n");                                             \
        }                                                                  \
    } while (0)

int main() {
    // Same seed, same answer; different seed, different answer.
    const MCResult a = MCPrice(true, 100, 0, 100, 1, 20, 3, 10000, 1), b = MCPrice(true, 100, 0, 100, 1, 20, 3, 10000, 1);
    const MCResult c = MCPrice(true, 100, 0, 100, 1, 20, 3, 10000, 2);
    CHECK(a.price == b.price && a.std_error == b.std_error, "same seed gave %.17g and %.17g", a.price, b.price);
    CHECK(a.price != c.price, "seeds 1 and 2 gave the same price");
    CHECK(a.ci_low == a.price - 1.959963984540054 * a.std_error && a.ci_high == a.price + 1.959963984540054 * a.std_error, "95%% interval");

    // Within 4 standard errors of the closed form at 10^6 paths (a correct pricer fails one such
    // check with probability 6e-5).
    struct Case { bool call; double spot, expiry, vol, rate; } cases[] = {
        {true, 100, 1, 20, 3}, {false, 100, 1, 20, 3}, {true, 80, 0.25, 30, 5}, {false, 120, 2, 50, 0}, {true, 150, 7.0 / 365, 20, 3},
    };
    for (const Case& k : cases) {
        const MCResult r = MCPrice(k.call, k.spot, 0, 100, k.expiry, k.vol, k.rate, 1000000, 42);
        const double bs = k.call ? BSCall(k.spot, 0, 100, k.expiry, k.vol, k.rate) : BSPut(k.spot, 0, 100, k.expiry, k.vol, k.rate);
        const double z = (r.price - bs) / r.std_error;
        std::printf("%s S=%g T=%g vol=%g r=%g: MC %.6f +/- %.6f (95%% CI %.6f to %.6f), closed form %.6f, z = %.2f\n",
                    k.call ? "call" : "put", k.spot, k.expiry, k.vol, k.rate, r.price, r.std_error, r.ci_low, r.ci_high, bs, z);
        CHECK(std::fabs(z) <= 4, "MC more than 4 standard errors from the closed form: z = %.2f", z);
    }

    // Standard error falls as 1/sqrt(paths): four times the paths, half the error (within 10%).
    const double ratio = MCPrice(true, 100, 0, 100, 1, 20, 3, 400000, 7).std_error / MCPrice(true, 100, 0, 100, 1, 20, 3, 100000, 7).std_error;
    std::printf("standard error ratio, 4x paths: %.4f\n", ratio);
    CHECK(std::fabs(ratio - 0.5) <= 0.05, "standard error ratio %.4f", ratio);

    // An option already at expiry has no sampling error.
    const MCResult expired = MCPrice(true, 110, 1, 100, 1, 20, 3, 1000, 3);
    CHECK(expired.price == 10 && expired.std_error == 0, "expired option %.17g +/- %g", expired.price, expired.std_error);

    // Paths that finished in the money: all of them for an expired option in the money, none for one
    // out of the money, and otherwise within 4 standard deviations (and one path, for a probability that
    // rounds to 1) of paths x the risk-neutral probability, N(d2) for a call and N(-d2) for a put.
    CHECK(expired.in_the_money == 1000, "expired call in the money: %llu of 1000 paths", (unsigned long long)expired.in_the_money);
    const MCResult expired_out = MCPrice(true, 90, 1, 100, 1, 20, 3, 1000, 3), expired_put = MCPrice(false, 90, 1, 100, 1, 20, 3, 1000, 3);
    CHECK(expired_out.in_the_money == 0 && expired_out.price == 0, "expired call out of the money: %llu paths", (unsigned long long)expired_out.in_the_money);
    CHECK(expired_put.in_the_money == 1000, "expired put in the money: %llu paths", (unsigned long long)expired_put.in_the_money);
    const NormalDistribution norm(0, 1);
    for (const Case& k : cases) {
        const double paths = 1000000, sd = k.vol / 100 * std::sqrt(k.expiry);
        const double d2 = (std::log(k.spot / 100) + (k.rate / 100 - k.vol * k.vol / 20000) * k.expiry) / sd;
        const double p = norm.cdf(k.call ? d2 : -d2), want = paths * p, bound = 4 * std::sqrt(want * (1 - p)) + 1;
        const double got = static_cast<double>(MCPrice(k.call, k.spot, 0, 100, k.expiry, k.vol, k.rate, 1000000, 42).in_the_money);
        std::printf("%s S=%g T=%g vol=%g r=%g: %.0f of 10^6 paths in the money, %.1f expected (bound +/- %.1f)\n", k.call ? "call" : "put", k.spot,
                    k.expiry, k.vol, k.rate, got, want, bound);
        CHECK(std::fabs(got - want) <= bound, "paths in the money: %.0f, expected %.1f +/- %.1f", got, want, bound);
    }

    bool threw = false;
    try { MCPrice(true, 100, 0, 100, 1, 20, 3, 1, 1); } catch (const std::invalid_argument&) { threw = true; }
    CHECK(threw, "one path must throw");

    std::printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
