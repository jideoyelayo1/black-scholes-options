#pragma once

// Parameter grid for tests/test_pricing.cpp, reused by the study in bench/.
// Strike is fixed at 100, so the spots run from deep out of the money to deep in the money.
// Vol and rate are in percent, expiry in years, matching BlackScholes.hpp.
constexpr double kStrike = 100;
constexpr double kSpots[] = {50, 80, 95, 100, 105, 120, 200};
constexpr double kExpiries[] = {1.0 / 365, 7.0 / 365, 0.25, 1, 5};
constexpr double kVols[] = {1, 5, 20, 50, 100, 300};
constexpr double kRates[] = {0, 3, 10};
