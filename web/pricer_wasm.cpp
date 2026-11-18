// Embind binding: the closed-form price and Greeks (BlackScholes.hpp), the implied-volatility solver
// (ImpliedVol.hpp) and the Monte Carlo pricer (MonteCarlo.hpp) as plain functions of numbers that
// return plain objects. Numbers cross as doubles. web/post.js replaces these raw functions with the
// public price, impliedVol and monteCarlo, which check every argument in JavaScript and pass on only
// numbers in range; it removes the raw ones from the module. The test build adds web/test_hooks.cpp;
// the release module has nothing else.
//
// Nothing is thrown from C++ into JavaScript: such an exception unwinds past WebAssembly without
// restoring its stack pointer, so each one leaks stack until the module fails. Every function below
// catches C++ exceptions (built with -fexceptions) and returns {ok: false, error, message} instead.
#include <emscripten/bind.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>

#include "BlackScholes.hpp"
#include "ImpliedVol.hpp"
#include "MonteCarlo.hpp"

using emscripten::val;

namespace {

val refusal(const char* error, const std::string& message) {
    val o = val::object();
    o.set("ok", false);
    o.set("error", std::string(error));
    o.set("message", message);
    return o;
}

// Runs a bound call; a C++ exception becomes a returned refusal rather than leaving WebAssembly. Its
// message starts with the function's name, as post.js's do.
template <class F>
val guarded(const char* fn, F call) {
    try {
        return call();
    } catch (const std::exception& e) {
        return refusal("internal_error", std::string(fn) + ": " + e.what());
    } catch (...) {
        return refusal("internal_error", std::string(fn) + ": unknown exception");
    }
}

std::string number(double x) {
    char s[32];
    std::snprintf(s, sizeof s, "%.10g", x);
    return s;
}

// A whole number of paths or a seed, from post.js; anything else becomes 0 (MCPrice refuses 0
// paths), so that the conversion is always defined.
std::uint64_t count(double x) { return x >= 0 && x < 18446744073709551616.0 ? static_cast<std::uint64_t>(x) : 0; }

}  // namespace

// Not static: web/test_hooks.cpp binds them, unchecked, into the test module. Every call has time 0,
// so expiry is the time to expiry in years; vol and rate are percentages (20 means 20%).

val rawPrice(bool call, double spot, double strike, double expiry, double vol, double rate) {
    return guarded("price", [&] {
        val o = val::object();
        o.set("ok", true);
        o.set("price", (call ? BSCall : BSPut)(spot, 0, strike, expiry, vol, rate));
        o.set("delta", (call ? BSCall_Delta : BSPut_Delta)(spot, 0, strike, expiry, vol, rate));
        o.set("gamma", (call ? BSCall_Gamma : BSPut_Gamma)(spot, 0, strike, expiry, vol, rate));
        o.set("vega", (call ? BSCall_Vega : BSPut_Vega)(spot, 0, strike, expiry, vol, rate));
        o.set("theta", (call ? BSCall_Theta : BSPut_Theta)(spot, 0, strike, expiry, vol, rate));
        return o;
    });
}

// implied_vol's own exceptions become named reasons. With expiry > 0 (post.js), it throws
// std::invalid_argument only for a price outside (max(S - K e^{-rT}, 0), S); since that lower bound
// is below S, the price is above the range exactly when it is not below S.
val rawImpliedVol(double price, double spot, double strike, double expiry, double rate) {
    return guarded("impliedVol", [&] {
        int iterations = 0;
        try {
            const double vol = implied_vol(price, spot, strike, expiry, rate, &iterations);
            val o = val::object();
            o.set("ok", true);
            o.set("vol", vol);
            o.set("iterations", iterations);
            return o;
        } catch (const std::invalid_argument&) {
            const double lower = std::fmax(spot - strike * std::exp(-rate / 100 * expiry), 0.0);
            if (!(price < spot))
                return refusal("above_upper_bound", "impliedVol: a call price must be below the spot, " + number(spot) + "; got " + number(price));
            return refusal("below_lower_bound", "impliedVol: a call price must be above max(S - K exp(-rT), 0) = " + number(lower) + "; got " + number(price));
        } catch (const std::domain_error&) {
            return refusal("vol_above_bracket", "impliedVol: the implied volatility is above 1000%, the top of the solver's bracket");
        } catch (const std::runtime_error&) {
            return refusal("not_converged", "impliedVol: the solver did not converge in 100 iterations");
        }
    });
}

val rawMonteCarlo(bool call, double spot, double strike, double expiry, double vol, double rate, double paths, double seed) {
    return guarded("monteCarlo", [&] {
        const MCResult r = MCPrice(call, spot, 0, strike, expiry, vol, rate, count(paths), count(seed));
        val o = val::object();
        o.set("ok", true);
        o.set("price", r.price);
        o.set("stdError", r.std_error);
        o.set("ciLow", r.ci_low);
        o.set("ciHigh", r.ci_high);
        o.set("closedForm", (call ? BSCall : BSPut)(spot, 0, strike, expiry, vol, rate));
        return o;
    });
}

EMSCRIPTEN_BINDINGS(pricer) {
    emscripten::function("_price", &rawPrice);
    emscripten::function("_impliedVol", &rawImpliedVol);
    emscripten::function("_monteCarlo", &rawMonteCarlo);
}
