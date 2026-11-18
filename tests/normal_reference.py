"""Reference values for tests/test_normal.cpp, to 25 significant digits, from Python's decimal module
at 800 digits (standard library only): the standard normal cdf, and Black-Scholes call and put
prices that are small compared with the spot and the strike. Inputs are the exact binary values of
the doubles the C++ test passes, so the references are for the same inputs.

    python3 tests/normal_reference.py
"""
from decimal import Decimal, getcontext

getcontext().prec = 800


def atan_inv(n):  # atan(1/n) by its series
    term, total, k = Decimal(1) / n, Decimal(0), 0
    n2 = Decimal(n) * n
    while term > Decimal(10) ** -790:
        total += term / (2 * k + 1) * (1 if k % 2 == 0 else -1)
        term /= n2
        k += 1
    return total


PI = 16 * atan_inv(5) - 4 * atan_inv(239)  # Machin's formula


def erf(z):  # the Maclaurin series; its terms reach e^(z^2), about 1e297 at z = 37 / sqrt(2), so 800 digits
    total, term, n = Decimal(0), z, 0
    while True:
        add = term / (2 * n + 1)
        total += add
        if abs(add) < Decimal(10) ** -780:
            return 2 / PI.sqrt() * total
        n += 1
        term *= -z * z / n


def cdf(x):
    x = Decimal(x)
    return (1 + erf(x / Decimal(2).sqrt())) / 2


def black_scholes(call, spot, strike, expiry, vol, rate):  # vol and rate in percent, as the library
    S, K, T, v, r = (Decimal(a) for a in (spot, strike, expiry, vol, rate))
    v, r = v / 100, r / 100
    d1 = ((S / K).ln() + (r + v * v / 2) * T) / (v * T.sqrt())
    d2 = d1 - v * T.sqrt()
    dk = K * (-r * T).exp()
    return S * cdf(d1) - dk * cdf(d2) if call else dk * cdf(-d2) - S * cdf(-d1)


if __name__ == "__main__":
    for x in (0.0, -1.0, -3.0, -5.0, -8.0, -10.0, -15.0, -20.0, -30.0, -37.0, 1.0, 3.0, 8.0):
        print(f"cdf {x!r}: {cdf(x):.24e}")
    for case in ((True, 100.0, 200.0, 0.25, 20.0, 3.0), (True, 50.0, 100.0, 7.0 / 365, 20.0, 3.0),
                 (True, 100.0, 100.0, 100.0, 20.0, -10.0), (True, 80.0, 100.0, 1.0, 5.0, 0.0),
                 (False, 200.0, 100.0, 0.25, 20.0, 3.0), (False, 150.0, 100.0, 1.0, 10.0, 3.0)):
        print(f"{'call' if case[0] else 'put'} {case[1:]!r}: {black_scholes(*case):.24e}")
