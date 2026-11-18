// The native side of web/test.mjs: reads one request per line from stdin, calls the library directly
// and prints each result's doubles as their 64-bit patterns in hex, so that the WebAssembly module's
// results can be compared bit for bit. Requests (time 0, so expiry is the time to expiry; vol and
// rate in percent):
//   bs call|put spot strike expiry vol rate        -> price delta gamma vega theta
//   iv price spot strike expiry rate               -> ok vol iterations, or throw <exception type>
//   mc call|put spot strike expiry vol rate paths seed -> price std_error ci_low ci_high in_the_money (decimal)
// Numbers arrive as JavaScript writes them (String(x), the shortest text that reads back exactly).
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

#include "BlackScholes.hpp"
#include "ImpliedVol.hpp"
#include "MonteCarlo.hpp"

static void bits(double x) {
    std::uint64_t b;
    std::memcpy(&b, &x, sizeof b);
    std::printf(" %016" PRIx64, b);
}

int main() {
    char line[512];
    while (std::fgets(line, sizeof line, stdin)) {
        const char* op = std::strtok(line, " \n");
        if (!op) continue;
        const char* type = std::strcmp(op, "iv") != 0 ? std::strtok(nullptr, " \n") : "call";
        const bool call = type && std::strcmp(type, "call") == 0;
        double a[8] = {};
        int n = 0;
        for (const char* t; n < 8 && (t = std::strtok(nullptr, " \n"));) a[n++] = std::strtod(t, nullptr);
        if (std::strcmp(op, "bs") == 0 && n == 5) {
            const double S = a[0], K = a[1], T = a[2], v = a[3], r = a[4];
            std::printf("bs");
            bits((call ? BSCall : BSPut)(S, 0, K, T, v, r));
            bits((call ? BSCall_Delta : BSPut_Delta)(S, 0, K, T, v, r));
            bits((call ? BSCall_Gamma : BSPut_Gamma)(S, 0, K, T, v, r));
            bits((call ? BSCall_Vega : BSPut_Vega)(S, 0, K, T, v, r));
            bits((call ? BSCall_Theta : BSPut_Theta)(S, 0, K, T, v, r));
        } else if (std::strcmp(op, "iv") == 0 && n == 5) {
            int iterations = 0;
            try {
                const double vol = implied_vol(a[0], a[1], a[2], a[3], a[4], &iterations);
                std::printf("ok");
                bits(vol);
                std::printf(" %d", iterations);
            } catch (const std::invalid_argument&) {
                std::printf("throw invalid_argument");
            } catch (const std::domain_error&) {
                std::printf("throw domain_error");
            } catch (const std::runtime_error&) {
                std::printf("throw runtime_error");
            }
        } else if (std::strcmp(op, "mc") == 0 && n == 7) {
            const MCResult r = MCPrice(call, a[0], 0, a[1], a[2], a[3], a[4], static_cast<std::uint64_t>(a[5]), static_cast<std::uint64_t>(a[6]));
            std::printf("mc");
            bits(r.price);
            bits(r.std_error);
            bits(r.ci_low);
            bits(r.ci_high);
            std::printf(" %llu", static_cast<unsigned long long>(r.in_the_money));
        } else {
            std::fprintf(stderr, "web_driver: cannot read a request starting %s\n", op);
            return 1;
        }
        std::printf("\n");
    }
    return 0;
}
