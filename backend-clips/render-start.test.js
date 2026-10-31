import assert from "node:assert/strict";
import test from "node:test";
import { planWorkerWake, renderStartLine } from "./render-start.js";

test("a render job is claimed without waiting a full poll cycle", () => {
  const pollMs = 6000;
  const idle = planWorkerWake({ running: false, pollMs });
  assert.equal(idle.runNow, true);
  assert.equal(idle.waitMs, 0);
  assert.ok(idle.waitMs < pollMs);

  const busy = planWorkerWake({ running: true, pollMs });
  assert.equal(busy.runNow, false);
  assert.equal(busy.againWhenIdle, true);
  assert.equal(busy.waitMs, 0);
  assert.ok(busy.waitMs < pollMs);

  const line = renderStartLine("job-1", "claimed", 1_000, () => 1_040);
  assert.equal(line, "[render-start] job=job-1 step=claimed t=1040 dtMs=40");
});
