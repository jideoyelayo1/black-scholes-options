#pragma once

#include <cmath>
#include "NormalDistribution.h"


double BSCall(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*Calculates the Black-Scholes call price.

  Parameters
  ----------
  spot: float
      The spot price of the underlying.
  time: float
      The time when the call price is to be evaluated.
  strike: float
      The strike price of the call.
  expiry: float
      The expiration date of the call.
  vol: float
      The implied volatility to use to price the call (as a percentage).
  rate: float
      The risk free interest rate to use in the model (as a percentage).

  Returns
  -------
  float
      The Black-Scholes call price.*/

    vol /= 100;
    rate /= 100;
    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    double d2 = (log(spot / strike) + (rate - pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    NormalDistribution norm(0, 1);

    return spot * norm.cdf(d1) - strike * exp(-rate * (expiry - time)) * norm.cdf(d2);
}

double BSPut(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes put price.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The Black-Scholes put price.
    */

    vol /= 100;

    rate /= 100;

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    double d2 = (log(spot / strike) + (rate - pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    NormalDistribution norm(0, 1);

    return -spot * norm.cdf(-d1) + strike * exp(-rate * (expiry - time)) * norm.cdf(-d2);
}


double BSCall_Delta(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes call delta.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The Black-Scholes call delta.
    */

    vol /= 100;
    rate /= 100;

    NormalDistribution norm(0, 1);

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);
    return norm.cdf(d1);
}


double BSPut_Delta(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes put delta.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The Black-Scholes put delta.
    */

    vol /= 100;

    rate /= 100;

    NormalDistribution norm(0, 1);

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    return -norm.cdf(-d1);
}


double BSCall_Gamma(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes call gamma.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The Black-Scholes call gamma.
    */

    vol /= 100;

    rate /= 100;

    NormalDistribution norm(0, 1);

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    return norm.pdf(d1) / spot / vol / sqrt(expiry - time);
}


double BSPut_Gamma(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes put gamma.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The Black-Scholes put gamma.
    */

    vol /= 100;

    rate /= 100;

    NormalDistribution norm(0, 1);

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    return norm.pdf(d1) / spot / vol / sqrt(expiry - time);
}


double BSCall_Theta(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes call theta, scaled to the 1 day change in option
        value due to time decay.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The 1 day Black-Scholes call theta.
    */

    vol /= 100;

    rate /= 100;

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    double d2 = (log(spot / strike) + (rate - pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    NormalDistribution norm(0, 1);

    double theta = -spot * vol * norm.pdf(d1) / 2 / sqrt(expiry - time) - rate * strike * exp(-rate * (expiry - time)) * norm.cdf(d2);

    return theta / 365;
}

double BSPut_Theta(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes put theta, scaled to the 1 day change in option
        value due to time decay.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The 1 day Black-Scholes put theta.
    */

    vol /= 100;

    rate /= 100;

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    NormalDistribution norm(0, 1);

    double d2 = (log(spot / strike) + (rate - pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    double theta = -spot * vol * norm.pdf(d1) / 2 / sqrt(expiry - time) + rate * strike * exp(-rate * (expiry - time)) * norm.cdf(-d2);

    return theta / 365;
}

double BSCall_Vega(double spot, double time, double strike, double expiry, double vol, double rate) {
    /*
        Calculates the Black-Scholes call vega.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The time when the call price is to be evaluated.
        strike: float
            The strike price of the call.
        expiry: float
            The expiration date of the call.
        vol: float
            The implied volatility to use to price the call (as a percentage).
        rate: float
            The risk free interest rate to use in the model (as a percentage).

        Returns
        -------
        float
            The Black-Scholes call vega.
    */

    vol /= 100;

    rate /= 100;

    NormalDistribution norm(0, 1);

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    return spot * sqrt(expiry - time) * norm.pdf(d1) / 100;
}

double BSPut_Vega(double spot, double time, double strike, double expiry, double vol, double rate) {/*
    Calculates the Black-Scholes call vega.

    Parameters
    ----------
    spot: float
        The spot price of the underlying.
    time: float
        The time when the call price is to be evaluated.
    strike: float
        The strike price of the call.
    expiry: float
        The expiration date of the call.
    vol: float
        The implied volatility to use to price the call (as a percentage).
    rate: float
        The risk free interest rate to use in the model (as a percentage).

    Returns
    -------
    float
        The Black-Scholes call vega.
*/

    vol /= 100;

    rate /= 100;

    NormalDistribution norm(0, 1);

    double d1 = (log(spot / strike) + (rate + pow(vol, 2) / 2) * (expiry - time)) / vol / sqrt(expiry - time);

    return spot * sqrt(expiry - time) * norm.pdf(d1) / 100;
}

