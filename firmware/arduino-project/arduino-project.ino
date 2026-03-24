#include "aw_runtime.h"

static aw::AnchorWatchRuntime g_runtime;

void setup() {
  g_runtime.setup();
}

void loop() {
  g_runtime.loop();
}
