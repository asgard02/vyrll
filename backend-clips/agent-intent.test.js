import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clipDetectPlan,
  clipWantCount,
  parseAgentIntentContract,
  requestedMomentsMax,
} from "./agent-intent.js";

describe("parseAgentIntentContract", () => {
  it("reads a versioned singular contract", () => {
    const c = parseAgentIntentContract(
      JSON.stringify({ v: 1, mode: "best", quantity: 1, focus: "" })
    );
    assert.equal(c.mode, "best");
    assert.equal(c.quantity, 1);
    assert.equal(requestedMomentsMax(c, 8), 1);
  });

  it("keeps plan budget for quantity all", () => {
    const c = parseAgentIntentContract(
      JSON.stringify({ v: 1, mode: "theme", quantity: "all", focus: "inflation" })
    );
    assert.equal(requestedMomentsMax(c, 8), 8);
  });

  it("wraps a legacy sentence", () => {
    const c = parseAgentIntentContract("priorise les passages sur l inflation");
    assert.equal(c.mode, "theme");
    assert.equal(c.quantity, "all");
    assert.match(c.focus, /inflation/);
  });
});

describe("clipDetectPlan", () => {
  it("locks n=1 for a singular intent", () => {
    const plan = clipDetectPlan(
      { agent_intent: JSON.stringify({ v: 1, mode: "best", quantity: 1, focus: "" }) },
      9
    );
    assert.equal(plan.n, 1);
    assert.equal(plan.lockOne, true);
  });

  it("caps n to two for a numbered contract", () => {
    const plan = clipDetectPlan(
      {
        agent_intent: JSON.stringify({
          v: 1,
          mode: "theme",
          quantity: 2,
          focus: "ia",
        }),
      },
      8
    );
    assert.equal(plan.n, 2);
    assert.equal(plan.lockOne, false);
    assert.equal(plan.contract.quantity, 2);
  });

  it("keeps momentsMax without a contract", () => {
    const plan = clipDetectPlan({ agent_intent: null }, 6);
    assert.equal(plan.n, 6);
    assert.equal(plan.lockOne, false);
  });
});

describe("clipWantCount", () => {
  it("uses clipsMax when the agent did not lock a quantity", () => {
    const plan = clipDetectPlan({ agent_intent: null }, 13);
    assert.equal(clipWantCount(plan, 10), 10);
  });

  it("honors a numbered agent quantity", () => {
    const plan = clipDetectPlan(
      {
        agent_intent: JSON.stringify({
          v: 1,
          mode: "theme",
          quantity: 2,
          focus: "ia",
        }),
      },
      13
    );
    assert.equal(clipWantCount(plan, 10), 2);
  });

  it("stays at 1 for a singular intent", () => {
    const plan = clipDetectPlan(
      { agent_intent: JSON.stringify({ v: 1, mode: "best", quantity: 1, focus: "" }) },
      13
    );
    assert.equal(clipWantCount(plan, 10), 1);
  });
});
