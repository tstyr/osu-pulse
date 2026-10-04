import { describe, expect, it } from "vitest";
import { renderQueueHasCapacity } from "./queue-capacity";

describe("manual render queue capacity", () => {
  it("accepts a manual render or batch while four automatic jobs wait for idle", () => {
    expect(renderQueueHasCapacity(4)).toBe(true);
    expect(renderQueueHasCapacity(4, 20)).toBe(true);
  });
  it("applies the same bounded queue capacity to single, comparison and batch jobs", () => {
    expect(renderQueueHasCapacity(99)).toBe(true);
    expect(renderQueueHasCapacity(100)).toBe(false);
    expect(renderQueueHasCapacity(81, 20)).toBe(false);
    expect(renderQueueHasCapacity(-1)).toBe(false);
    expect(renderQueueHasCapacity(0, Infinity)).toBe(false);
  });
});
