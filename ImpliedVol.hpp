#pragma once

#include <stdexcept>
#include <cmath>
#include "BlackScholes.hpp"


inline double implied_vol(double price, double spot, double strike, double expiry, double rate, int* iterations = nullptr) {
    /*
        Recovers the Black-Scholes volatility of a European call from its price.

        Method: Newton's method on vol, started at the Manaster-Koehler point
        sqrt(2 |ln(S/K) + rT| / T) (floored at 1%). A step that leaves the bracket, or
        fails to halve |price error| from the previous iterate, is replaced by bisection.
        Bracket: [0%, 1000%], narrowed on every iteration using the sign of the price error.
        Stops when a step or the bracket is below 1e-10 vol points; at most 100 iterations
        (bisection alone reaches 1e-10 in 44).

        Parameters
        ----------
        price: float
            The call price. Must lie strictly between max(spot - strike*exp(-rate*expiry), 0) and spot.
        spot, strike: float
        expiry: float
            Time to expiry in years, > 0.
        rate: float
            The risk free interest rate (as a percentage).
        iterations: int*, optional
            If given, receives the number of iterations used.

        Returns
        -------
        float
            The implied volatility (as a percentage).

        Throws std::invalid_argument for a price outside the no-arbitrage bounds or a
        non-positive expiry, std::domain_error if the vol is above the bracket.
    */
    const double lower = fmax(spot - strike * exp(-rate / 100 * expiry), 0.0);
    if (!(expiry > 0 && price > lower && price < spot)) throw std::invalid_argument("Option price out of range");

    double lo = 0, hi = 1000;
    if (BSCall(spot, 0, strike, expiry, hi, rate) < price) throw std::domain_error("Implied vol above 1000%");

    double vol = fmax(100 * sqrt(2 * fabs(log(spot / strike) + rate / 100 * expiry) / expiry), 1.0);
    double previous_error = INFINITY;
    for (int i = 1; i <= 100; ++i) {
        const double error = BSCall(spot, 0, strike, expiry, vol, rate) - price;
        if (iterations) *iterations = i;
        if (error == 0) return vol;
        (error > 0 ? hi : lo) = vol;  // the call price rises with vol

        double next = vol - error / BSCall_Vega(spot, 0, strike, expiry, vol, rate);
        if (next > lo && next < hi && fabs(next - vol) <= 1e-10) return next;
        if (!(next > lo && next < hi) || fabs(error) > 0.5 * fabs(previous_error)) next = (lo + hi) / 2;
        if (hi - lo <= 1e-10) return next;

        previous_error = error;
        vol = next;
    }
    throw std::runtime_error("Implied vol did not converge");
}
