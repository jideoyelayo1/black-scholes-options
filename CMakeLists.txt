cmake_minimum_required(VERSION 3.16)
project(black_scholes_options CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()
if(NOT MSVC)
  add_compile_options(-Wall -Wextra)
endif()

include_directories(${CMAKE_SOURCE_DIR} ${CMAKE_SOURCE_DIR}/tests)

add_executable(options_demo main.cpp options.cpp NormalDistribution.cpp)
add_executable(test_pricing tests/test_pricing.cpp)
add_executable(test_mc tests/test_mc.cpp)
add_executable(test_normal tests/test_normal.cpp)
add_executable(study bench/study.cpp)
add_executable(web_driver web/driver.cpp)  # the native side of web/test.mjs

enable_testing()
add_test(NAME pricing COMMAND test_pricing)
add_test(NAME monte_carlo COMMAND test_mc)
add_test(NAME normal_cdf COMMAND test_normal)
