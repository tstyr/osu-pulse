import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardRestore, markApplied, preparePush, publishSnapshot, readSnapshot } from "./shared-db-snapshot.mjs";

const fixtures = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "osu-pulse-snapshot-test-"));
  fixtures.push(root);
  const directory = join(root, "backups");
  mkdirSync(directory);
  const state = join(root, "applied.id");
  const publish = (platform = "windows") => {
    const path = join(directory, "osu-pulse.test.tmp");
    writeFileSync(path, `fixture-${platform}`);
    return publishSnapshot(directory, state, path, platform);
  };
  return { root, directory, state, publish };
}
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("portable database snapshots", () => {
  it("publishes an immutable generation and a matching applied ID", () => {
    const f = fixture();
    const id = f.publish();
    expect(readSnapshot(f.directory)?.id).toBe(id);
    expect(readFileSync(f.state, "utf8").trim()).toBe(id);
    expect(readFileSync(readSnapshot(f.directory).path, "utf8")).toBe("fixture-windows");
  });
  it("refuses to overwrite an unapplied snapshot from another OS", () => {
    const f = fixture(); f.publish();
    writeFileSync(f.state, "arch-old-snapshot");
    expect(() => preparePush(f.directory, f.state)).toThrow("newer database snapshot");
  });
  it("keeps the latest and previous generations and preserves unrelated files", () => {
    const f = fixture();
    writeFileSync(join(f.directory, "unrelated.dump"), "keep");
    const oldest = f.publish(); const previous = f.publish("arch"); const latest = f.publish();
    expect(existsSync(join(f.directory, `osu-pulse.${oldest}.dump`))).toBe(false);
    expect(existsSync(join(f.directory, `osu-pulse.${previous}.dump`))).toBe(true);
    expect(readSnapshot(f.directory).id).toBe(latest);
    expect(readFileSync(join(f.directory, "osu-pulse.previous.id"), "utf8").trim()).toBe(previous);
    expect(existsSync(join(f.directory, "unrelated.dump"))).toBe(true);
  });
  it("can read a legacy snapshot without rewriting it", () => {
    const f = fixture();
    writeFileSync(join(f.directory, "osu-pulse.latest.id"), "arch-host-20261003T000000Z");
    writeFileSync(join(f.directory, "osu-pulse.latest.dump"), "legacy");
    expect(readSnapshot(f.directory).path).toBe(join(f.directory, "osu-pulse.latest.dump"));
    markApplied(f.state, "arch-host-20261003T000000Z");
    expect(() => f.publish()).not.toThrow();
    expect(readFileSync(join(f.directory, "osu-pulse.latest.dump"), "utf8")).toBe("legacy");
  });
  it("rejects corrupted pointers and never substitutes a legacy dump for a missing v2 generation", () => {
    const f = fixture();
    writeFileSync(join(f.directory, "osu-pulse.latest.id"), "../../outside");
    expect(() => readSnapshot(f.directory)).toThrow("ID is invalid");
    writeFileSync(join(f.directory, "osu-pulse.latest.id"), "v2-arch-missing");
    writeFileSync(join(f.directory, "osu-pulse.latest.dump"), "wrong-generation");
    expect(() => readSnapshot(f.directory)).toThrow("incomplete");
  });
  it("does not publish an empty dump or one outside the backup directory", () => {
    const f = fixture();
    const empty = join(f.directory, "osu-pulse.empty.tmp"); writeFileSync(empty, "");
    expect(() => publishSnapshot(f.directory, f.state, empty, "arch")).toThrow("empty");
    const outside = join(f.root, "osu-pulse.outside.tmp"); writeFileSync(outside, "no");
    expect(() => publishSnapshot(f.directory, f.state, outside, "arch")).toThrow("inside");
    expect(readSnapshot(f.directory)).toBeNull();
  });
  it("rechecks the shared generation after the dump has been prepared", () => {
    const f = fixture();
    const first = f.publish();
    preparePush(f.directory, f.state);
    const next = f.publish("arch");
    // Simulate a previously started writer still carrying the first ID.
    writeFileSync(f.state, first);
    const pending = join(f.directory, "osu-pulse.pending.tmp");
    writeFileSync(pending, "stale writer");
    expect(() => publishSnapshot(f.directory, f.state, pending, "windows")).toThrow("newer database snapshot");
    expect(readSnapshot(f.directory).id).toBe(next);
    expect(existsSync(pending)).toBe(true);
  });
  it("rejects a zero-byte generation and leaves the latest pointer intact", () => {
    const f = fixture();
    const id = f.publish();
    writeFileSync(readSnapshot(f.directory).path, "");
    expect(() => readSnapshot(f.directory)).toThrow("incomplete");
    expect(readFileSync(join(f.directory, "osu-pulse.latest.id"), "utf8").trim()).toBe(id);
  });
  it("blocks restoration when the Bot is alive even if its heartbeat is stale", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "work"));
    const heartbeat = join(f.root, "work", "bot-heartbeat.json");
    writeFileSync(heartbeat, JSON.stringify({ pid: 12345 }));
    const stale = new Date(Date.now() - 60_000);
    utimesSync(heartbeat, stale, stale);
    await expect(guardRestore(f.root, { probePort: async () => false, probeProcess: (pid) => pid === 12345 })).rejects.toThrow("Stop Bot");
  });
  it("blocks restoration for a live runtime lock without a heartbeat", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "work"));
    writeFileSync(join(f.root, "work", "bot-runtime.lock"), JSON.stringify({ pid: 45678 }));
    await expect(guardRestore(f.root, { probePort: async () => false, probeProcess: (pid) => pid === 45678 })).rejects.toThrow("Stop Bot");
  });
  it("allows restoration after old Bot processes and service ports have stopped", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "work"));
    const heartbeat = join(f.root, "work", "bot-heartbeat.json");
    writeFileSync(heartbeat, JSON.stringify({ pid: 12345 }));
    const stale = new Date(Date.now() - 60_000);
    utimesSync(heartbeat, stale, stale);
    await expect(guardRestore(f.root, { probePort: async () => false, probeProcess: () => false })).resolves.toBeUndefined();
    await expect(guardRestore(f.root, { probePort: async (port) => port === 8765, probeProcess: () => false })).rejects.toThrow("Stop Bot");
  });
});
