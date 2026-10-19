import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clipUserIdGate } from "./clip-user-id.js";

const VALID = "11111111-1111-4111-8111-111111111111";

describe("clipUserIdGate", () => {
  it("returns 400 for a missing, empty, or non-uuid user without calling supabase", () => {
    const calls = [];
    const supabase = {
      from(table) {
        calls.push(table);
      },
    };
    for (const raw of [undefined, null, "", "   ", "pas-un-uuid"]) {
      const gate = clipUserIdGate(raw);
      assert.equal(gate.ok, false);
      assert.equal(gate.status, 400);
      assert.equal(gate.error, "user_id manquant");
      if (gate.ok) supabase.from("clip_jobs");
    }
    assert.deepEqual(calls, []);
  });

  it("lets a valid uuid through the guard", () => {
    const gate = clipUserIdGate(`  ${VALID}  `);
    assert.equal(gate.ok, true);
    assert.equal(gate.userId, VALID);
  });
});
