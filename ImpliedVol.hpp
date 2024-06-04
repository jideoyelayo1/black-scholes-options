#pragma once

#include <stdexcept>
#include <cmath>
#include "NormalDistribution.hpp" // Check if this contains norm.cdf and norm.pdf


double implied_vol(double price, double spot, double strike, double expiry, double rate) {
    rate /= 100;
    double tolerance = 0.00000001;
    double theta = 1;

    // Check if option price is within reasonable bounds
    if (spot - exp(-rate * expiry) * strike >= price or price >= spot) {
        throw std::invalid_argument("Option price out of range");
    }

    double x = log(exp(rate * expiry) * spot / strike);
    double scaled_price = price * exp(rate * expiry / 2) / sqrt(spot * strike);

    // Define normal distribution object
    NormalDistribution norm(0, 1);

    // Define lambda function F
    auto F = [&theta, &x, &norm](double sigma) {
        return theta * exp(x / 2) * norm.cdf(theta * (x / sigma + sigma / 2)) -
            theta * exp(-x / 2) * norm.cdf(theta * (x / sigma - sigma / 2));
        };

    // Define lambda function Fprime
    auto Fprime = [&theta, &x, &norm](double sigma) {
        return exp(x / 2) * norm.pdf(theta * (x / sigma + sigma / 2)) * (-x / (sigma * sigma) + 0.5) -
            exp(-x / 2) * norm.pdf(theta * (x / sigma - sigma / 2)) * (-x / (sigma * sigma) - 0.5);
        };

    double sigma_c = sqrt(2 * abs(x));
    double b_c = F(sigma_c);

    if (scaled_price >= b_c) {
        double pval = (exp(theta * x / 2) - scaled_price) * norm.cdf(-sqrt(abs(x) / 2)) / (exp(theta * x / 2) - b_c);
        double old_sigma = -2 * norm.pdf(pval);
        double new_sigma = old_sigma - (F(old_sigma) - scaled_price) / Fprime(old_sigma);

        while (abs(new_sigma - old_sigma) > tolerance) {
            old_sigma = new_sigma;
            new_sigma = old_sigma - (F(old_sigma) - scaled_price) / Fprime(old_sigma);
        }

        return 100 * new_sigma / sqrt(expiry);
    }

    double iota;
    if (theta * x <= 0)
        iota = 0;
    else
        iota = theta * (exp(x / 2) - exp(-x / 2));

    // Define lambda function G
    auto G = [&iota, &scaled_price, &F](double sigma) {
        return log(F(sigma) - iota) - log(scaled_price - iota);
        };

    // Define lambda function Gprime
    auto Gprime = [&iota, &F, &Fprime](double sigma) {
        return Fprime(sigma) / (F(sigma) - iota);
        };

    double old_sigma = sqrt(2 * x * x / (abs(x) - 4 * log((scaled_price - iota) / (b_c - iota))));
    double new_sigma = old_sigma - G(old_sigma) / Gprime(old_sigma);

    while (abs(new_sigma - old_sigma) > tolerance) {
        old_sigma = new_sigma;
        new_sigma = old_sigma - G(old_sigma) / Gprime(old_sigma);
    }

    return 100 * new_sigma / sqrt(expiry);
}
