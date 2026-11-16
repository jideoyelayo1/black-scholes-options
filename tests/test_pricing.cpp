// Checks for the closed-form prices, the Greeks and the Option class.
// Every tolerance below was fixed before the first run; bench/RESULTS.md explains each one.
// Prints one FAIL line per failed check, then the worst-case residuals, and exits non-zero on any failure.
#include <cmath>
#include <initializer_list>
#include <cstdio>
#include <stdexcept>

#include "BlackScholes.hpp"
#include "options.hpp"
#include "grid.hpp"

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

// NaN never counts as near.
static bool near(double got, double want, double rtol, double atol) {
    return std::fabs(got - want) <= rtol * std::fabs(want) + atol;
}

template <class F> static bool throws(F f) {
    try { f(); } catch (const std::exception&) { return true; }
    return false;
}

using Fn = double (*)(double, double, double, double, double, double);

static void reference_values() {
    // Hull, Options, Futures, and Other Derivatives: S=42, K=40, r=10%, vol=20%, T=0.5 gives c=4.76, p=0.81.
    CHECK(near(BSCall(42, 0, 40, 0.5, 20, 10), 4.76, 0, 0.005), "Hull call %.6f", BSCall(42, 0, 40, 0.5, 20, 10));
    CHECK(near(BSPut(42, 0, 40, 0.5, 20, 10), 0.81, 0, 0.005), "Hull put %.6f", BSPut(42, 0, 40, 0.5, 20, 10));
    // Hull's 20-week example: S=49, K=50, r=5%, vol=20%, T=20/52: price 2.40, delta 0.522, gamma 0.066,
    // vega 12.1 per unit vol (0.121 per vol point), theta -4.31 per year (-0.0118 per calendar day).
    const double T = 20.0 / 52;
    CHECK(near(BSCall(49, 0, 50, T, 20, 5), 2.40, 0, 0.005), "Hull 20w price %.6f", BSCall(49, 0, 50, T, 20, 5));
    CHECK(near(BSCall_Delta(49, 0, 50, T, 20, 5), 0.522, 0, 0.0005), "Hull 20w delta %.6f", BSCall_Delta(49, 0, 50, T, 20, 5));
    CHECK(near(BSCall_Gamma(49, 0, 50, T, 20, 5), 0.066, 0, 0.0005), "Hull 20w gamma %.6f", BSCall_Gamma(49, 0, 50, T, 20, 5));
    CHECK(near(BSCall_Vega(49, 0, 50, T, 20, 5), 0.121, 0, 0.0005), "Hull 20w vega %.6f", BSCall_Vega(49, 0, 50, T, 20, 5));
    CHECK(near(BSCall_Theta(49, 0, 50, T, 20, 5), -0.0118, 0, 0.00005), "Hull 20w theta %.6f", BSCall_Theta(49, 0, 50, T, 20, 5));
    // S=K=100, r=5%, vol=20%, T=1: c=10.4506, p=5.5735 (4 d.p.).
    CHECK(near(BSCall(100, 0, 100, 1, 20, 5), 10.4506, 0, 5e-5), "ATM call %.8f", BSCall(100, 0, 100, 1, 20, 5));
    CHECK(near(BSPut(100, 0, 100, 1, 20, 5), 5.5735, 0, 5e-5), "ATM put %.8f", BSPut(100, 0, 100, 1, 20, 5));
}

static void parity_bounds_and_greeks() {
    double worst_parity = 0, worst_delta_parity = 0;
    double worst[4] = {0, 0, 0, 0};  // worst |analytic - finite difference| / (rtol*|analytic| + atol), per Greek
    const char* names[4] = {"delta", "gamma", "vega", "theta"};
    int cases = 0;
    for (double S : kSpots) for (double T : kExpiries) for (double vol : kVols) for (double r : kRates) {
        ++cases;
        const double K = kStrike, c = BSCall(S, 0, K, T, vol, r), p = BSPut(S, 0, K, T, vol, r);
        const double fwd = S - K * std::exp(-r / 100 * T), disc_k = K * std::exp(-r / 100 * T);

        // Put-call parity, C - P = S - K exp(-r T), to 1e-10 of the strike.
        const double parity = std::fabs(c - p - fwd);
        worst_parity = std::fmax(worst_parity, parity);
        CHECK(parity <= 1e-10 * K, "parity S=%g T=%g vol=%g r=%g residual %.3e", S, T, vol, r, parity);
        const double dparity = std::fabs(BSCall_Delta(S, 0, K, T, vol, r) - BSPut_Delta(S, 0, K, T, vol, r) - 1);
        worst_delta_parity = std::fmax(worst_delta_parity, dparity);
        CHECK(dparity <= 1e-12, "delta parity S=%g T=%g vol=%g r=%g residual %.3e", S, T, vol, r, dparity);

        // No-arbitrage bounds, with rounding slack of 1e-12 of the strike.
        const double slack = 1e-12 * K;
        CHECK(c >= std::fmax(fwd, 0) - slack && c <= S + slack, "call bounds S=%g T=%g vol=%g r=%g c=%.17g", S, T, vol, r, c);
        CHECK(p >= std::fmax(-fwd, 0) - slack && p <= disc_k + slack, "put bounds S=%g T=%g vol=%g r=%g p=%.17g", S, T, vol, r, p);

        // Greeks against central finite differences of the price function alone.
        // Steps scale with the natural width of the price curve, S*vol*sqrt(T), with vol and T themselves.
        const double width = S * vol / 100 * std::sqrt(T);
        for (int call = 0; call < 2; ++call) {
            const Fn V = call ? BSCall : BSPut;
            const Fn greek[4] = {call ? BSCall_Delta : BSPut_Delta, call ? BSCall_Gamma : BSPut_Gamma,
                                 call ? BSCall_Vega : BSPut_Vega, call ? BSCall_Theta : BSPut_Theta};
            const double hs = 1e-4 * width, hg = 1e-3 * width, hv = 1e-4 * vol, ht = 1e-3 * T;
            const double fd[4] = {
                (V(S + hs, 0, K, T, vol, r) - V(S - hs, 0, K, T, vol, r)) / (2 * hs),
                (V(S + hg, 0, K, T, vol, r) - 2 * V(S, 0, K, T, vol, r) + V(S - hg, 0, K, T, vol, r)) / (hg * hg),
                (V(S, 0, K, T, vol + hv, r) - V(S, 0, K, T, vol - hv, r)) / (2 * hv),           // per vol point
                (V(S, ht, K, T, vol, r) - V(S, -ht, K, T, vol, r)) / (2 * ht) / 365,            // per calendar day
            };
            const double rtol[4] = {1e-6, 1e-5, 1e-6, 1e-6}, atol[4] = {1e-8, 1e-6, 1e-8, 1e-8};
            for (int g = 0; g < 4; ++g) {
                const double a = greek[g](S, 0, K, T, vol, r);
                const double score = std::fabs(a - fd[g]) / (rtol[g] * std::fabs(a) + atol[g]);
                worst[g] = std::fmax(worst[g], std::isnan(score) ? INFINITY : score);
                CHECK(near(fd[g], a, rtol[g], atol[g]), "%s %s S=%g T=%g vol=%g r=%g analytic %.12g fd %.12g",
                      call ? "call" : "put", names[g], S, T, vol, r, a, fd[g]);
            }
        }
    }
    std::printf("grid: %d cases (x2 for call and put)\n", cases);
    std::printf("worst put-call parity residual: %.3e (tolerance %.0e)\n", worst_parity, 1e-10 * kStrike);
    std::printf("worst delta parity residual: %.3e (tolerance 1e-12)\n", worst_delta_parity);
    for (int g = 0; g < 4; ++g)
        std::printf("worst %s finite-difference error as a fraction of its tolerance: %.3e\n", names[g], worst[g]);
}

static void boundaries() {
    // At expiry (time == expiry) the price is the payoff, including at the strike.
    CHECK(BSCall(110, 1, 100, 1, 20, 3) == 10 && BSPut(110, 1, 100, 1, 20, 3) == 0, "expiry ITM call");
    CHECK(BSCall(90, 1, 100, 1, 20, 3) == 0 && BSPut(90, 1, 100, 1, 20, 3) == 10, "expiry OTM call");
    CHECK(BSCall(100, 1, 100, 1, 20, 3) == 0, "expiry at the strike: call %g", BSCall(100, 1, 100, 1, 20, 3));
    CHECK(BSPut(100, 1, 100, 1, 20, 3) == 0, "expiry at the strike: put %g", BSPut(100, 1, 100, 1, 20, 3));
    // Zero vol: the price is the discounted intrinsic value, including at the forward.
    CHECK(near(BSCall(110, 0, 100, 1, 0, 3), 110 - 100 * std::exp(-0.03), 1e-14, 0), "zero vol call %.17g", BSCall(110, 0, 100, 1, 0, 3));
    CHECK(BSCall(100, 0, 100, 1, 0, 0) == 0, "zero vol at the forward: call %g", BSCall(100, 0, 100, 1, 0, 0));
    CHECK(BSPut(100, 0, 100, 1, 0, 0) == 0, "zero vol at the forward: put %g", BSPut(100, 0, 100, 1, 0, 0));
    // Away from the strike the Greeks have finite limits at expiry and at zero vol.
    CHECK(BSCall_Gamma(110, 1, 100, 1, 20, 3) == 0, "gamma at expiry %g", BSCall_Gamma(110, 1, 100, 1, 20, 3));
    CHECK(BSPut_Gamma(90, 1, 100, 1, 20, 3) == 0, "put gamma at expiry %g", BSPut_Gamma(90, 1, 100, 1, 20, 3));
    CHECK(BSCall_Gamma(110, 0, 100, 1, 0, 3) == 0, "gamma at zero vol %g", BSCall_Gamma(110, 0, 100, 1, 0, 3));
    CHECK(near(BSCall_Theta(110, 1, 100, 1, 20, 3), -0.03 * 100 / 365, 1e-14, 0), "ITM call theta at expiry %g", BSCall_Theta(110, 1, 100, 1, 20, 3));
    CHECK(BSPut_Theta(110, 1, 100, 1, 20, 3) == 0, "OTM put theta at expiry %g", BSPut_Theta(110, 1, 100, 1, 20, 3));
    CHECK(BSCall_Delta(110, 1, 100, 1, 20, 3) == 1 && BSPut_Delta(110, 1, 100, 1, 20, 3) == 0, "delta at expiry");
    CHECK(BSCall_Vega(110, 1, 100, 1, 20, 3) == 0, "vega at expiry %g", BSCall_Vega(110, 1, 100, 1, 20, 3));
    // Very short expiry at the forward, r=0: C = S * erf(vol*sqrt(T) / (2*sqrt(2))) exactly.
    for (double T : {1e-6, 1e-8, 1e-10}) {
        const double want = 100 * std::erf(0.2 * std::sqrt(T) / (2 * std::sqrt(2.0)));
        CHECK(near(BSCall(100, 0, 100, T, 20, 0), want, 1e-8, 0), "short expiry T=%g call %.17g want %.17g", T, BSCall(100, 0, 100, T, 20, 0), want);
    }
    // Deep in and out of the money.
    CHECK(near(BSCall(1000, 0, 100, 1, 20, 3), 1000 - 100 * std::exp(-0.03), 1e-14, 0), "deep ITM call %.17g", BSCall(1000, 0, 100, 1, 20, 3));
    CHECK(near(BSPut(10, 0, 100, 1, 20, 3), 100 * std::exp(-0.03) - 10, 1e-14, 0), "deep ITM put %.17g", BSPut(10, 0, 100, 1, 20, 3));
    CHECK(BSCall(10, 0, 100, 1, 20, 3) >= 0 && BSCall(10, 0, 100, 1, 20, 3) < 1e-20, "deep OTM call %g", BSCall(10, 0, 100, 1, 20, 3));
    CHECK(BSPut(1000, 0, 100, 1, 20, 3) >= 0 && BSPut(1000, 0, 100, 1, 20, 3) < 1e-20, "deep OTM put %g", BSPut(1000, 0, 100, 1, 20, 3));
}

static void option_class() {
    Option o(100, 1, "call");
    CHECK(!throws([&] { o.set_strike(90); }) && o.get_strike() == 90, "set_strike(90)");
    CHECK(!throws([&] { o.set_expiry(2); }) && o.get_expiry() == 2, "set_expiry(2)");
    CHECK(near(o.price(100, 0, 20, 3), BSCall(100, 0, 90, 2, 20, 3), 0, 0), "price after setters");
    CHECK(throws([&] { o.set_strike(0); }), "set_strike(0) must throw");
    CHECK(throws([&] { o.set_expiry(-1); }), "set_expiry(-1) must throw");
    CHECK(throws([&] { o.price(100, 3, 20, 3); }), "price after expiry must throw");
    CHECK(throws([&] { Option(100, 1, "type").price(100, 0, 20, 3); }), "invalid type must throw");
    Option put(100, 1, "put");
    CHECK(put.price(100, 0, 20, 5) == BSPut(100, 0, 100, 1, 20, 5), "put dispatch");
}

int main() {
    reference_values();
    parity_bounds_and_greeks();
    boundaries();
    option_class();
    std::printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
