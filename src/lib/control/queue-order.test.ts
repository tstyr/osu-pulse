import { describe, expect, it } from "vitest";
import { moveQueuedJobBefore } from "./queue-order";

const jobs = [
  { jobId: "running", status: "rendering" },
  ...["a", "b", "c"].map((jobId) => ({ jobId, status: "queued" })),
];

describe("render queue drag ordering", () => {
  it("moves an earlier job before a later target rather than after it", () => {
    expect(moveQueuedJobBefore(jobs, "a", "c")?.map((job) => job.jobId)).toEqual(["running", "b", "a", "c"]);
    expect(jobs.map((job) => job.jobId)).toEqual(["running", "a", "b", "c"]);
  });
  it("moves a later job before an earlier target and preserves active positions", () => {
    expect(moveQueuedJobBefore(jobs, "c", "a")?.map((job) => job.jobId)).toEqual(["running", "c", "a", "b"]);
  });
  it("rejects missing, active, and self targets", () => {
    expect(moveQueuedJobBefore(jobs, "a", "running")).toBeNull();
    expect(moveQueuedJobBefore(jobs, "missing", "c")).toBeNull();
    expect(moveQueuedJobBefore(jobs, "a", "a")).toBeNull();
  });
});
