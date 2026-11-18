#pragma once
#include <cmath>
#ifndef M_PI
#define M_PI       3.14159265358979323846   // pi
#endif



class NormalDistribution {
private:
    double mean; // Mean
    double stddev; // Standard deviation
public:
    // Constructor
    NormalDistribution(double mean, double stddev) : mean(mean), stddev(stddev) {}

    // Probability density function (PDF)
    double pdf(double x) const {
        return (1.0 / (stddev * sqrt(2 * M_PI))) * exp(-(x - mean) * (x - mean) / (2 * stddev * stddev));
    }

    // Cumulative distribution function (CDF)
    double cdf(double x) const {
        return 0.5 * erfc(-(x - mean) / (stddev * sqrt(2)));  // erfc keeps the lower tail's relative accuracy
    }
};
