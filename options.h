#pragma once

#include <string>
#include <cmath>
#include <stdexcept>

#include "BlackScholes.h"
//#include "additional-maths.cpp"


class Option {
    /*
    Class for option products.

    Attributes
    ----------
    strike: float
        The strike price of the option.
    expiry: float
        The expiration date of the option, in years.
    type: string
        Either "call" or "put" indicating the option type.
    */
private:
    double strike;
    double expiry;
    std::string type;
public:
    Option(double strike = 0.0, double expiry = 0.0, std::string type = "call") : strike(strike), expiry(expiry), type(type) {}

    double get_strike() {
        /*
        Returns the value of the strike attribute, the strike price of the option.

        Parameters
        ----------
        None

        Returns
        -------
        float
            The strike price.
        */
        return strike;
    }

    double get_expiry() {
        /*
          Returns the value of the expiry attribute, the expiration date of the option

          Parameters
          ----------
          None

          Returns
          -------
          float
              The expiration date.
          */
        return expiry;
    }

    std::string get_type() {
        /*
        Returns the option type.

        Parameters
        ----------
        None

        Returns
        -------
        string
            The option type.
        */
        return type;
    }

    void set_strike(double _strike = 0.0) {
        /*
        Sets the strike price of the option, overwriting any existing value for the
        strike attribute.

        Parameters
        ----------
        strike: float
            The new strike.

        Returns
        -------
        None
        */
        throw std::invalid_argument("Strike price can not be empty");
        strike = _strike;
    }

    void set_expiry(double _expiry) {
        /*
        Sets the expiration date for the option, overwriting any existing value for the
        expiry attribute.

        Parameters
        ----------
        expiry: float
            The new expiration date (in years).

        Returns
        -------
        None
        */
        throw std::invalid_argument("Must provide an expiry");
        expiry = _expiry;
    }

    void set_type(std::string _type) {
        /*
        Sets the expiration date for the option, overwriting any existing value for the
        expiry attribute.

        Parameters
        ----------
        expiry: float
            The new expiration date (in years).

        Returns
        -------
        None
        */
        if (_type == "call") { type = _type;return; }

        if (_type == "put") { type = _type;return; }

        throw std::invalid_argument("Must provide a type");

    }

    double price(double spot, double time, double vol, double rate) {
        /*
        Returns the option price.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The date the option should be priced for.
        vol: float
            The implied volatility to use for pricing.
        rate: float
            The risk free interest rate to use (as a percantage).

        Returns
        -------
        float
            The option price or premium.
        */
        if (time > expiry) { throw std::invalid_argument("Evaluation time must precede expiry"); }

        if (type == "call") return BSCall(spot, time, strike, expiry, vol, rate);
        if (type != "put")  throw std::invalid_argument("Invalid type");

        //else:
        return BSPut(spot, time, strike, expiry, vol, rate);
    }


    double delta(double spot, double time, double vol, double rate) {
        /*
        Returns the option delta.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The date the option should be priced for.
        vol: float
            The implied volatility to use for pricing.
        rate: float
            The risk free interest rate to use (as a percantage).

        Returns
        -------
        float
            The option delta.
        */
        if (time > expiry) throw std::invalid_argument("Evaluation time must precede expiry");
        if (type == "call") return BSCall_Delta(spot, time, strike, expiry, vol, rate);
        if (type != "put")  throw std::invalid_argument("Invalid type");
        return BSPut_Delta(spot, time, strike, expiry, vol, rate);
    }


    double gamma(double spot, double time, double vol, double rate) {
        /*
        Returns the option gamma.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The date the option should be priced for.
        vol: float
            The implied volatility to use for pricing.
        rate: float
            The risk free interest rate to use (as a percantage).

        Returns
        -------
        float
            The option gamma.
        */
        if (time > expiry) throw std::invalid_argument("Evaluation time must precede expiry");

        if (type == "call")return BSCall_Gamma(spot, time, strike, expiry, vol, rate);
        if (type != "put") throw std::invalid_argument("Invalid type");
        return BSPut_Gamma(spot, time, strike, expiry, vol, rate);
    }


    double vega(double spot, double time, double vol, double rate) {
        /*
        Returns the option vega.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The date the option should be priced for.
        vol: float
            The implied volatility to use for pricing.
        rate: float
            The risk free interest rate to use (as a percantage).

        Returns
        -------
        float
            The option vega.
        */
        if (time > expiry) throw std::invalid_argument("Evaluation time must precede expiry");

        if (type == "call")return BSCall_Vega(spot, time, strike, expiry, vol, rate);
        if (type != "put") throw std::invalid_argument("Invalid type");
        return BSPut_Vega(spot, time, strike, expiry, vol, rate);
    }


    double theta(double spot, double time, double vol, double rate) {
        /*
        Returns the option theta.

        Parameters
        ----------
        spot: float
            The spot price of the underlying.
        time: float
            The date the option should be priced for.
        vol: float
            The implied volatility to use for pricing.
        rate: float
            The risk free interest rate to use (as a percantage).

        Returns
        -------
        float
            The option theta.
        */
        if (time > expiry) throw std::invalid_argument("Evaluation time must precede expiry");

        if (type == "call") return BSCall_Theta(spot, time, strike, expiry, vol, rate);
        if (type != "put")  throw std::invalid_argument("Invalid type");
        return BSPut_Theta(spot, time, strike, expiry, vol, rate);

    }

};