import { it, expect, vi } from "vitest";
import { waitForSettledRequests } from "../../tools/runtime-readiness.js";
it("waits for all request terminal events and a quiet interval", async () => {
  vi.useFakeTimers();
  try {
    const state = {
      pending: new Map<unknown, string>([["r", "/dynamic.json"]]),
      lastActivity: Date.now(),
    };
    let settled = false;
    const ready = waitForSettledRequests(state, 1000, 100).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);
    state.pending.delete("r");
    state.lastActivity = Date.now();
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(51);
    await ready;
    expect(settled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("never accepts a request without a finish/failure terminal event", async () => {
  vi.useFakeTimers();
  try {
    const state = {
      pending: new Map<unknown, string>([
        ["r", "https://cdn.invalid/hanging.js"],
      ]),
      lastActivity: Date.now(),
    };
    const ready = expect(
      waitForSettledRequests(state, 200, 50),
    ).rejects.toThrow("https://cdn.invalid/hanging.js");
    await vi.advanceTimersByTimeAsync(250);
    await ready;
  } finally {
    vi.useRealTimers();
  }
});
