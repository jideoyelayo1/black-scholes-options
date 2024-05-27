# README

## Overview

This project provides a comprehensive set of tools for financial options pricing and simulations. It includes classes and functions to handle options, compute their Greeks using the Black-Scholes model, perform Monte Carlo simulations, and interface with Python using `pybind11`. 

## Structure

The project is divided into the following components:

1. **Orderbook**: A placeholder class for managing orders.
2. **Option**: A class for handling option products and computing their prices and Greeks using the Black-Scholes model.
3. **Black-Scholes Functions**: Standalone functions for computing option prices and Greeks based on the Black-Scholes model.
4. **Monte Carlo Simulator**: A class for performing Monte Carlo simulations for option pricing.
5. **Python Bindings**: Integration with Python using `pybind11` for all major classes and functions.

## Files

- **Orderbook.h**: Contains the definition of the `Orderbook` class.
- **options.h**: Contains the definition of the `Option` class.
- **black-sholes.h**: Contains the definitions of Black-Scholes pricing functions.
- **normal_distribution.h**: Contains the definition of the `NormalDistribution` class.
- **MonteCarloSimulator.h**: Contains the definition of the `MonteCarloSimulator` class.
- **implied_volatility.h**: Contains the implementation of the implied volatility calculation.
- **pybind11_module.cpp**: Contains the `pybind11` module definitions for all classes and functions.

## Installation

1. **Clone the repository**:
    ```sh
    git clone https://github.com/your-repo/financial-options.git
    cd financial-options
    ```

2. **Build the project**:
    Ensure you have CMake and a C++ compiler installed. Then run:
    ```sh
    mkdir build
    cd build
    cmake ..
    make
    ```

3. **Install Python dependencies**:
    ```sh
    pip install pybind11
    ```

## Usage

### Option Pricing

1. **Import the modules in Python**:
    ```python
    import options
    import BlackScholes
    import MonteCarloSimulator
    ```

2. **Fetch the data (assuming `getData` function is defined in `getData.py`)**:
    ```python
    from getData import getData

    stockTicker = "AAPL"
    callOrPut = "call"
    expiry = 1
    spot_price, volatility, strike_price = getData(stockTicker, callOrPut)
    ```

3. **Create an Option instance and calculate the price**:
    ```python
    option = options.Option(strike_price, expiry, callOrPut)
    optionPrice = option.price(
        spot_price,
        1,      # time
        volatility,
        1       # rate
    )

    print(f"Option Price is ${optionPrice:.2f}")
    ```

### Monte Carlo Simulation

1. **Create a Monte Carlo Simulator instance and run the simulation**:
    ```python
    simulator = MonteCarloSimulator.MonteCarloSimulator(
        num_simulations=10000,
        spot_price=spot_price,
        strike_price=strike_price,
        risk_free_rate=1,  # as a percentage
        volatility=volatility,
        maturity=expiry
    )

    simulated_price = simulator.simulate()
    print(f"Simulated Option Price is ${simulated_price:.2f}")
    ```

## Additional Features

### Greeks Calculation

The `Option` class provides methods to calculate the Greeks:
- **Delta**: `option.delta(spot, time, vol, rate)`
- **Gamma**: `option.gamma(spot, time, vol, rate)`
- **Vega**: `option.vega(spot, time, vol, rate)`
- **Theta**: `option.theta(spot, time, vol, rate)`

### Implied Volatility

Use the `implied_vol` function to calculate implied volatility given an option price:
```cpp
#include "implied_volatility.h"

double impliedVol = implied_vol(optionPrice, spot, strike, expiry, rate);
```

## Notes

- Ensure that the additional header files such as `additional-maths.h` are available and contain necessary functions like `norm.cdf` and `norm.pdf`.
- Error handling is implemented to catch invalid inputs for strike price, expiry, and type.
- The provided `Orderbook` class is currently a placeholder and needs implementation based on specific requirements.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.

## Contributions

Contributions are welcome! Please fork the repository and submit a pull request for any enhancements or bug fixes.

## Contact

For any questions or issues, please open an issue on GitHub or contact the repository owner.

---

This README provides an overview of the financial options project, details on its structure and usage, and instructions for installation and running examples. It is designed to help users quickly get started with options pricing and simulation using the provided classes and functions.
