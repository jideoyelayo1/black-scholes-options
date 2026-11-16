// The option-pricing study: the implied-vol round trip over tests/grid.hpp, and the Monte Carlo
// convergence and coverage sweep against the closed form. Writes CSVs into <out_dir> and a summary
// to stdout. Usage: study <out_dir> [replicates, default 1000]. See bench/RESULTS.md.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

#include "BlackScholes.hpp"
#include "ImpliedVol.hpp"
#include "MonteCarlo.hpp"
#include "grid.hpp"

static FILE* open_csv(const std::string& dir, const char* name, const char* header) {
    FILE* f = std::fopen((dir + "/" + name).c_str(), "w");
    if (!f) { std::perror(name); std::exit(1); }
    std::fprintf(f, "%s\n", header);
    return f;
}

static double median(std::vector<double> v) {
    std::sort(v.begin(), v.end());
    const size_t n = v.size();
    return n % 2 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

// Least-squares slope of y on x and its standard error.
static void fit(const std::vector<double>& x, const std::vector<double>& y, double& slope, double& se) {
    const double n = x.size();
    double mx = 0, my = 0, sxx = 0, sxy = 0, rss = 0;
    for (size_t i = 0; i < x.size(); ++i) { mx += x[i] / n; my += y[i] / n; }
    for (size_t i = 0; i < x.size(); ++i) { sxx += (x[i] - mx) * (x[i] - mx); sxy += (x[i] - mx) * (y[i] - my); }
    slope = sxy / sxx;
    for (size_t i = 0; i < x.size(); ++i) { const double e = y[i] - my - slope * (x[i] - mx); rss += e * e; }
    se = std::sqrt(rss / (n - 2) / sxx);
}

static void implied_vol_round_trip(const std::string& dir) {
    FILE* csv = open_csv(dir, "iv_roundtrip.csv",
                         "spot,strike,expiry,rate,vol,price,vega,well_conditioned,status,vol_solved,abs_error,price_residual,iterations");
    int cases = 0, rejected = 0, above = 0, unconverged = 0, ill_converged = 0, ill_off = 0;
    double worst_well = 0, worst_ill = 0, worst_residual = 0;
    std::vector<double> iters_well, iters_ill;
    for (double S : kSpots) for (double T : kExpiries) for (double vol : kVols) for (double r : kRates) {
        ++cases;
        const double K = kStrike, price = BSCall(S, 0, K, T, vol, r), vega = BSCall_Vega(S, 0, K, T, vol, r);
        const bool well = vega >= 1e-5;  // same threshold as tests/test_pricing.cpp
        const char* status = "converged";
        int it = 0;
        double got = NAN;
        try { got = implied_vol(price, S, K, T, r, &it); }
        catch (const std::invalid_argument&) { status = "rejected_at_bounds"; ++rejected; }
        catch (const std::domain_error&) { status = "rejected_above_bracket"; ++above; }
        catch (const std::runtime_error&) { status = "not_converged"; ++unconverged; }
        const double err = std::fabs(got - vol), residual = std::fabs(BSCall(S, 0, K, T, got, r) - price);
        std::fprintf(csv, "%g,%g,%.10g,%g,%g,%.17g,%.6e,%d,%s,%.17g,%.6e,%.6e,%d\n", S, K, T, r, vol, price, vega, well, status,
                     got, err, residual, it);
        if (std::isnan(got)) continue;
        worst_residual = std::fmax(worst_residual, residual);
        if (well) { worst_well = std::fmax(worst_well, err); iters_well.push_back(it); }
        else { ++ill_converged; worst_ill = std::fmax(worst_ill, err); iters_ill.push_back(it); ill_off += err > 1e-6; }
    }
    std::fclose(csv);
    std::printf("== implied vol round trip (call prices; grid in tests/grid.hpp)\n");
    std::printf("cases %d; well-conditioned (vega >= 1e-5 per vol point) %zu, worst |error| %.3e vol points\n", cases,
                iters_well.size(), worst_well);
    std::printf("iterations, well-conditioned: median %g, max %g\n", median(iters_well),
                *std::max_element(iters_well.begin(), iters_well.end()));
    std::printf("ill-conditioned and solved: %d, of which %d off by more than 1e-6 points; worst |error| %.3e vol points; iterations median %g, max %g\n",
                ill_converged, ill_off, worst_ill, iters_ill.empty() ? 0 : median(iters_ill),
                iters_ill.empty() ? 0 : *std::max_element(iters_ill.begin(), iters_ill.end()));
    std::printf("rejected at the no-arbitrage bounds %d; above the 1000%% bracket %d; not converged in 100 iterations %d\n",
                rejected, above, unconverged);
    std::printf("worst price residual |BS(solved vol) - price| over every solved case: %.3e\n\n", worst_residual);
}

static void monte_carlo(const std::string& dir, int replicates) {
    // The page's example option: K = 100, vol = 20%, r = 3%, T = 1 year, spot at the strike.
    const double S = 100, K = 100, T = 1, vol = 20, rate = 3;
    const double bs = BSCall(S, 0, K, T, vol, rate);
    const std::uint64_t path_counts[] = {100, 316, 1000, 3162, 10000, 31623, 100000, 316228, 1000000, 3162278, 10000000};
    std::printf("== Monte Carlo, European call S=%g K=%g T=%g vol=%g%% r=%g%%; closed form %.12f; parity residual %.1e\n", S, K, T,
                vol, rate, bs, std::fabs(bs - BSPut(S, 0, K, T, vol, rate) - (S - K * std::exp(-rate / 100 * T))));
    std::printf("seeds 1..%d at every path count; mt19937_64 + std::normal_distribution\n", replicates);
    std::printf("%10s %12s %12s %12s %12s %9s %17s\n", "paths", "mean est", "rmse", "median|err|", "mean se", "coverage", "coverage 95% CI");

    FILE* raw = open_csv(dir, "mc_raw.csv", "paths,seed,estimate,std_error,ci_low,ci_high,error,covered");
    FILE* summary = open_csv(dir, "mc_convergence.csv",
                             "paths,replicates,closed_form,mean_estimate,rmse,median_abs_error,mean_std_error,coverage,coverage_ci_low,coverage_ci_high");
    std::vector<double> log_n, log_rmse, log_median, log_se;
    long covered_total = 0, runs_total = 0;
    for (std::uint64_t n : path_counts) {
        std::vector<double> abs_errors;
        double sum = 0, sum_sq_err = 0, sum_se = 0;
        int covered = 0;
        for (int seed = 1; seed <= replicates; ++seed) {
            const MCResult r = MCPrice(true, S, 0, K, T, vol, rate, n, seed);
            const double err = r.price - bs;
            const bool in = r.ci_low <= bs && bs <= r.ci_high;
            std::fprintf(raw, "%llu,%d,%.12g,%.6e,%.12g,%.12g,%.6e,%d\n", (unsigned long long)n, seed, r.price, r.std_error,
                         r.ci_low, r.ci_high, err, in);
            abs_errors.push_back(std::fabs(err));
            sum += r.price; sum_sq_err += err * err; sum_se += r.std_error; covered += in;
        }
        const double rmse = std::sqrt(sum_sq_err / replicates), med = median(abs_errors), mean_se = sum_se / replicates;
        const double p = double(covered) / replicates, half = 1.959963984540054 * std::sqrt(p * (1 - p) / replicates);
        std::fprintf(summary, "%llu,%d,%.12f,%.12f,%.6e,%.6e,%.6e,%.4f,%.4f,%.4f\n", (unsigned long long)n, replicates, bs,
                     sum / replicates, rmse, med, mean_se, p, p - half, p + half);
        std::printf("%10llu %12.6f %12.4e %12.4e %12.4e %9.4f %8.4f to %.4f\n", (unsigned long long)n, sum / replicates, rmse, med,
                    mean_se, p, p - half, p + half);
        log_n.push_back(std::log10(double(n)));
        log_rmse.push_back(std::log10(rmse));
        log_median.push_back(std::log10(med));
        log_se.push_back(std::log10(mean_se));
        covered_total += covered;
        runs_total += replicates;
    }
    std::fclose(raw);
    std::fclose(summary);
    double slope, se;
    fit(log_n, log_rmse, slope, se);
    std::printf("log-log slope, rmse against paths: %.4f +/- %.4f (standard error of the fit)\n", slope, se);
    fit(log_n, log_median, slope, se);
    std::printf("log-log slope, median |error| against paths: %.4f +/- %.4f\n", slope, se);
    fit(log_n, log_se, slope, se);
    std::printf("log-log slope, mean standard error against paths: %.4f +/- %.4f\n", slope, se);
    std::printf("pooled coverage of the 95%% interval: %ld of %ld = %.4f\n\n", covered_total, runs_total, double(covered_total) / runs_total);
}

static void call_curve(const std::string& dir) {
    // The page's call-curve figure: K = 100, vol = 20%, r = 3%, T = 1 year.
    FILE* csv = open_csv(dir, "call_curve.csv", "spot,call,delta,gamma");
    for (int s = 50; s <= 150; ++s)
        std::fprintf(csv, "%d,%.12f,%.12f,%.12f\n", s, BSCall(s, 0, 100, 1, 20, 3), BSCall_Delta(s, 0, 100, 1, 20, 3),
                     BSCall_Gamma(s, 0, 100, 1, 20, 3));
    std::fclose(csv);
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <out_dir> [replicates]\n", argv[0]); return 2; }
    const int replicates = argc > 2 ? std::atoi(argv[2]) : 1000;
    if (replicates < 2) { std::fprintf(stderr, "replicates must be at least 2\n"); return 2; }
    implied_vol_round_trip(argv[1]);
    monte_carlo(argv[1], replicates);
    call_curve(argv[1]);
    return 0;
}
