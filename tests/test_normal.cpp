// Checks NormalDistribution::cdf and Black-Scholes prices that are small beside the spot and the
// strike against references from tests/normal_reference.py (Python's decimal module at 800 digits).
// Prints the worst relative errors and exits non-zero on any failure.
#include <cmath>
#include <cstdio>

#include "BlackScholes.hpp"
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
    // The cdf to a relative error of 1e-12 everywhere, the lower tail included. (1 + erf(x / sqrt 2)) / 2
    // cannot do that: 1 + erf(x / sqrt 2) cancels, to exactly 0 below about x = -8.3. What remains is the
    // rounding of x / sqrt 2, whose effect on the tail grows as x^2: about 1e-13 at x = -30.
    const NormalDistribution norm(0, 1);
    const struct { double x, want; } cdfs[] = {
        {0.0, 5.000000000000000000000000e-1},   {-1.0, 1.586552539314570514147675e-1},  {-3.0, 1.349898031630094526651815e-3},
        {-5.0, 2.866515718791939116737523e-7},  {-8.0, 6.220960574271784123515995e-16}, {-10.0, 7.619853024160526065973343e-24},
        {-15.0, 3.670966199312750885786090e-51}, {-20.0, 2.753624118606233695075623e-89}, {-30.0, 4.906713927148187059533809e-198},
        {-37.0, 5.725571222524576822683193e-300}, {1.0, 8.413447460685429485852325e-1}, {3.0, 9.986501019683699054733482e-1},
        {8.0, 9.999999999999993779039426e-1},
    };
    double worst_cdf = 0;
    for (const auto& c : cdfs) {
        const double got = norm.cdf(c.x), error = std::fabs(got - c.want) / c.want;
        worst_cdf = std::fmax(worst_cdf, std::isnan(error) ? INFINITY : error);
        CHECK(error <= 1e-12, "cdf(%g) = %.17g, reference %.17g, relative error %.3g", c.x, got, c.want, error);
    }

    // Small prices, where the price is a small difference of terms or a far tail (vol and rate in percent),
    // to a relative error of 1e-9: the rounding of d1 and d2 is amplified there, most where the two
    // terms of the formula nearly cancel.
    const struct { bool call; double spot, strike, expiry, vol, rate, want; } prices[] = {
        {true, 100, 200, 0.25, 20, 3, 6.963457792102130922001478e-12},
        {true, 50, 100, 7.0 / 365, 20, 3, 2.088523164258172739192595e-139},
        {true, 100, 100, 100, 20, -10, 9.940202816118152768447264e-4},
        {true, 80, 100, 1, 5, 0, 3.719833181306796064223904e-6},
        {false, 200, 100, 0.25, 20, 3, 2.363267447040338422064542e-12},
        {false, 150, 100, 1, 10, 3, 1.687374464381164982769860e-5},
    };
    double worst_price = 0;
    for (const auto& p : prices) {
        const double got = (p.call ? BSCall : BSPut)(p.spot, 0, p.strike, p.expiry, p.vol, p.rate);
        const double error = std::fabs(got - p.want) / p.want;
        worst_price = std::fmax(worst_price, std::isnan(error) ? INFINITY : error);
        CHECK(error <= 1e-9, "%s S=%g K=%g T=%g vol=%g r=%g: %.17g, reference %.17g, relative error %.3g", p.call ? "call" : "put",
              p.spot, p.strike, p.expiry, p.vol, p.rate, got, p.want, error);
    }
    std::printf("worst relative error of the cdf over %zu points: %.3e (tolerance 1e-12); of %zu small prices: %.3e (tolerance 1e-9)\n",
                sizeof cdfs / sizeof cdfs[0], worst_cdf, sizeof prices / sizeof prices[0], worst_price);
    std::printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
