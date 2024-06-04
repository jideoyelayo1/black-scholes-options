#include <iostream>
#include "./options.hpp"

int main()
{
    Option option(1, 1, "type");
    auto strike = option.get_strike();

    std::cout << strike << std::endl;
}
