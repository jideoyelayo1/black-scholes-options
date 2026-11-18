// Test hooks, linked only into the test build of the module (web/build.sh writes it to
// build/wasm-test/pricer_test.mjs), never into the release module in web/dist: stackPointer() and
// heapSize(), so that web/test.mjs can check that refused calls leave the stack pointer where it was
// and the memory as large as it was, and uncheckedMonteCarlo(), the raw Monte Carlo function without
// web/post.js's checks, so that it can make the library throw (MCPrice with fewer than 2 paths)
// inside a bound call.
#include <emscripten/bind.h>
#include <emscripten/heap.h>
#include <emscripten/stack.h>

using emscripten::val;

val rawMonteCarlo(bool call, double spot, double strike, double expiry, double vol, double rate, double paths, double seed);  // web/pricer_wasm.cpp

EMSCRIPTEN_BINDINGS(pricer_test) {
    using emscripten::optional_override;
    emscripten::function("stackPointer", optional_override([] { return static_cast<double>(emscripten_stack_get_current()); }));
    emscripten::function("heapSize", optional_override([] { return static_cast<double>(emscripten_get_heap_size()); }));
    emscripten::function("uncheckedMonteCarlo", &rawMonteCarlo);
}
