import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LavalinkManager, Player } from "lavalink-client";

const mocks = vi.hoisted(() => ({ queues: vi.fn() }));
vi.mock("../src/db/feature-repository", () => ({ listMusicQueues: mocks.queues }));
vi.mock("../src/db/music-repository", () => ({}));
vi.mock("./local-audio", () => ({}));
vi.mock("./ytdlp", () => ({ isYoutubeUrl: () => false }));

import { restoreMusicQueues } from "./music";

beforeEach(() => { vi.resetAllMocks(); });

describe("music queue restoration", () => {
  it("can retry after the DB temporarily rejects the initial snapshot lookup", async () => {
    mocks.queues.mockRejectedValueOnce(new Error("temporary DB outage")).mockResolvedValueOnce([]);
    const manager = {} as LavalinkManager;
    await expect(restoreMusicQueues(manager)).rejects.toThrow("temporary DB outage");
    await expect(restoreMusicQueues(manager)).resolves.toBeUndefined();
    expect(mocks.queues).toHaveBeenCalledTimes(2);
  });

  it("removes a half-created player so a later retry can restore the guild", async () => {
    mocks.queues.mockResolvedValue([{ guildId: "guild", voiceChannelId: "voice", textChannelId: "text", volume: 20, tracks: [] }]);
    const player = { connected: false, connect: vi.fn().mockRejectedValue(new Error("voice connection interrupted")) } as unknown as Player;
    let existing: Player | undefined;
    const destroyPlayer = vi.fn(async () => { existing = undefined; });
    const createPlayer = vi.fn(() => { existing = player; return player; });
    const manager = { getPlayer: () => existing, createPlayer, destroyPlayer } as unknown as LavalinkManager;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await restoreMusicQueues(manager);
      await restoreMusicQueues(manager);
      expect(createPlayer).toHaveBeenCalledTimes(2);
      expect(destroyPlayer).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});
