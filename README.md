### Project README

This project implements functionalities for pricing and analyzing financial options using the Black-Scholes model. It includes classes and functions for calculating option prices, deltas, gammas, vegas, and thetas for both call and put options.

#### Components:

1. **`NormalDistribution` Class**: 
   - A class representing a normal distribution with methods to compute the probability density function (PDF) and cumulative distribution function (CDF).

2. **`Option` Class**: 
   - A class representing option products with attributes for strike price, expiration date, and type (call or put). It provides methods for retrieving and setting these attributes, as well as calculating option prices and Greeks (delta, gamma, vega, theta).

3. **`BSCall` and `BSPut` Functions**: 
   - Functions to calculate the Black-Scholes call and put prices, respectively.

4. **`BSCall_Delta` and `BSPut_Delta` Functions**: 
   - Functions to calculate the Black-Scholes call and put deltas, respectively.

5. **`BSCall_Gamma` and `BSPut_Gamma` Functions**: 
   - Functions to calculate the Black-Scholes call and put gammas, respectively.

6. **`BSCall_Theta` and `BSPut_Theta` Functions**: 
   - Functions to calculate the Black-Scholes call and put thetas, respectively.

7. **`BSCall_Vega` and `BSPut_Vega` Functions**: 
   - Functions to calculate the Black-Scholes call and put vegas, respectively.

#### Usage:

1. **`NormalDistribution` Class**:
   - Instantiate the class with the desired mean and standard deviation.
   - Use the `pdf(x)` method to compute the probability density function at a given value `x`.
   - Use the `cdf(x)` method to compute the cumulative distribution function at a given value `x`.

2. **`Option` Class**:
   - Instantiate the class with the desired strike price, expiration date, and type (call or put).
   - Use the getter methods (`get_strike()`, `get_expiry()`, `get_type()`) to retrieve option attributes.
   - Use the setter methods (`set_strike()`, `set_expiry()`, `set_type()`) to set option attributes.
   - Use the `price()`, `delta()`, `gamma()`, `vega()`, and `theta()` methods to calculate various option metrics.

#### Example:

```cpp
#include <iostream>
#include "options.h"

int main() {
    Option option(100, 1, "call");
    double price = option.price(110, 0.5, 20, 5);
    double delta = option.delta(110, 0.5, 20, 5);
    double gamma = option.gamma(110, 0.5, 20, 5);
    double vega = option.vega(110, 0.5, 20, 5);
    double theta = option.theta(110, 0.5, 20, 5);

    std::cout << "Price: " << price << std::endl;
    std::cout << "Delta: " << delta << std::endl;
    std::cout << "Gamma: " << gamma << std::endl;
    std::cout << "Vega: " << vega << std::endl;
    std::cout << "Theta: " << theta << std::endl;

    return 0;
}
```

#### Notes:

- Ensure that you have included all necessary header files and linked additional math libraries as required.
- Always validate input parameters to avoid errors and unexpected behavior.

Feel free to reach out for any questions or feedback!
