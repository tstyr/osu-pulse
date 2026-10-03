import { expect, it, vi } from "vitest";
import { nonOverlappingTask } from "./non-overlapping-task";

it("skips overlapping ticks and resumes after failure", async () => {
  let reject!: (error: Error) => void;
  const task = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const onError = vi.fn();
  const run = nonOverlappingTask(task, onError);
  const pending = run();
  await run();
  expect(task).toHaveBeenCalledTimes(1);
  reject(new Error("offline"));
  await pending;
  await run();
  expect(onError).toHaveBeenCalledOnce();
  expect(task).toHaveBeenCalledTimes(2);
});
