import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ values: vi.fn(), conflict: vi.fn() }));
vi.mock("./index", () => ({ getDb: () => ({
  insert: () => ({ values: (values: unknown) => {
    mocks.values(values);
    return { onConflictDoUpdate: mocks.conflict };
  } }),
}) }));
import { recordGuildActivity } from "./community-repository";

beforeEach(() => vi.clearAllMocks());

describe("guild activity atomic counters", () => {
  it.each([
    ["message", 1, 0, 0],
    ["voice-join", 0, 1, 0],
    ["voice-leave", 0, 0, 1],
  ] as const)("records %s without reading and replacing a prior count", async (kind, messages, joins, leaves) => {
    await recordGuildActivity({ guildId: "guild", discordUserId: "person", kind, occurredAt: new Date("2026-10-06T12:34:56Z") });
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      bucketHour: new Date("2026-10-06T12:00:00Z"),
      messageCount: messages, voiceJoinCount: joins, voiceLeaveCount: leaves,
      activeDiscordUserIds: ["person"],
    }));
    const change = mocks.conflict.mock.calls[0][0].set;
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(change.messageCount as SQL)).toMatchObject({
      sql: '"discord_activity_buckets"."message_count" + $1', params: [messages],
    });
    expect(dialect.sqlToQuery(change.voiceJoinCount as SQL).params).toEqual([joins]);
    expect(dialect.sqlToQuery(change.voiceLeaveCount as SQL).params).toEqual([leaves]);
    const usersSql = dialect.sqlToQuery(change.activeDiscordUserIds as SQL).sql;
    expect(usersSql).toContain("select distinct active_id");
    expect(usersSql).toContain("excluded.active_discord_user_ids");
    expect(usersSql).toContain("limit 5000");
  });
});
