import { describe, expect, it, vi } from "vitest";
import { ApplicationCommandType, MessageFlags, PermissionFlagsBits, PermissionsBitField, type Interaction } from "discord.js";
import { commands, legacyCommands } from "./commands";
import { canUsePulseAction, flattenPulseCommands, pulseActions, validatePulseValue } from "./pulse-catalog";
import { PulseSessionStore } from "./pulse-session";
import { pulseCommandInteraction, pulseResultIsPrivate } from "./pulse-adapter";
import { dailyPlays, deviation, firstMilestones, improvementCandidates, playSessions, type AnalysisPlay } from "./pulse-analysis";

const mocks = vi.hoisted(() => ({ handle: vi.fn(async (...args: unknown[]) => { void args; }), analytics: vi.fn(async (...args: unknown[]) => { void args; }), recent: vi.fn(async (...args: unknown[]) => { void args; return { plays: [], accountCount: 0 }; }) }));
vi.mock("./handlers", () => ({ handleCommand: mocks.handle }));
vi.mock("./pulse-analytics", () => ({ handlePulseAnalytics: mocks.analytics }));
vi.mock("./render", () => ({ getRenderableRecentPlays: mocks.recent }));
import { handlePulseInteraction } from "./pulse-panel";

describe("pulse catalog", () => {
  it("registers one slash command while preserving the message render shortcut", () => {
    expect(commands.filter((item) => "description" in item).map((item) => item.name)).toEqual(["pulse"]);
    expect(commands.some((item) => item.type === ApplicationCommandType.Message)).toBe(true);
  });
  it("retains every legacy leaf and selected enhancement exactly once", () => {
    const leaves = flattenPulseCommands(legacyCommands);
    expect(leaves.length).toBe(79);
    expect(new Set(pulseActions.map((item) => item.id)).size).toBe(pulseActions.length);
    for (const leaf of leaves) expect(pulseActions).toContainEqual(leaf);
    expect(pulseActions.filter((item) => item.extra)).toHaveLength(9);
    for (const action of pulseActions) expect(action.options.length).toBeLessThanOrEqual(25);
  });
  it("separates ordinary users, guild admins and application operators", () => {
    const normal = { userId: "1", guildId: "2", permissions: BigInt(0), operator: false };
    const admin = { ...normal, permissions: PermissionFlagsBits.ManageGuild };
    for (const action of pulseActions) {
      expect(canUsePulseAction(action, normal)).toBe(action.access === "general");
      expect(canUsePulseAction(action, admin)).toBe(action.access !== "operator");
      if (action.access === "admin") expect(canUsePulseAction(action, { ...admin, guildId: null })).toBe(false);
      if (action.access === "operator") expect(canUsePulseAction(action, { ...normal, operator: true })).toBe(true);
    }
    expect(pulseActions.find((item) => item.id === "ticket/setup")?.access).toBe("admin");
  });
  it("rejects invalid types, choices and numeric bounds", () => {
    const number = { type: 4, name: "n", description: "件数", required: true, min_value: 1, max_value: 10 };
    for (const value of [null, 0, 11, NaN, Infinity, 1.2, "3"]) expect(validatePulseValue(number, value)).toBeTruthy();
    expect(validatePulseValue(number, 3)).toBeNull();
    expect(validatePulseValue({ type: 3, name: "mode", description: "mode", choices: [{ name: "mania", value: "mania" }] }, "other")).toBeTruthy();
    expect(validatePulseValue({ type: 7, name: "channel", description: "通知先", channel_types: [0] }, { id: "123", type: 2 })).toBeTruthy();
  });
});
it("binds sessions to user/guild/channel, expires and prevents double consumption", () => {
  let time = 0;
  const store = new PulseSessionStore(() => time, 2);
  const session = store.create("u", "g", "c");
  expect(store.get(session.id, "other", "g", "c")).toBeNull();
  expect(store.get(session.id, "u", "other", "c")).toBeNull();
  expect(store.get(session.id, "u", "g", "other")).toBeNull();
  expect(store.claim(session, 0)).toBe(true);
  expect(store.claim(session, 0)).toBe(false);
  time = 3_600_001;
  expect(store.get(session.id, "u", "g", "c")).toBeNull();
});

function play(overrides: Partial<AnalysisPlay> = {}): AnalysisPlay {
  return { osuScoreId: "123", beatmapId: 1, title: "map", difficulty: "hard", pp: 100, accuracy: 0.95, rank: "A", starRating: 4,
    mods: [], passed: true, isPersonalBest: false, endedAt: new Date("2026-10-01T10:00:00Z"), ...overrides };
}
describe("analysis calculations", () => {
  it("splits sessions at a 45 minute gap and sorts unordered records", () => {
    expect(playSessions([play({ endedAt: new Date("2026-10-01T12:00:00Z") }), play()]).map((group) => group.length)).toEqual([1, 1]);
    expect(deviation([0.9, 0.9])).toBe(0);
  });
  it("uses JST boundaries and does not count unknown PP as zero in averages", () => {
    const days = dailyPlays([play({ endedAt: new Date("2026-10-01T15:00:00Z"), pp: null })]);
    expect(days.get("2026-10-02")).toEqual({ count: 1, pp: [], accuracy: [0.95] });
  });
  it("does not merge mod variants or recommend already restored bests", () => {
    const newer = new Date("2026-10-01T11:00:00Z");
    expect(improvementCandidates([play({ pp: 150 }), play({ pp: 100, endedAt: newer, mods: ["DT"] })])).toEqual([]);
    expect(improvementCandidates([play({ pp: 150 }), play({ pp: 100, endedAt: newer })])[0].gap).toBe(50);
    expect(improvementCandidates([play(), play({ pp: 150, endedAt: newer })])).toEqual([]);
  });
  it("does not infer FC and excludes failed plays from milestone PP thresholds", () => {
    const result = firstMilestones([play({ pp: 200, passed: false }), play({ pp: 100, rank: "S" })]);
    expect(result.some((item) => item.label === "初 200pp")).toBe(false);
    expect(result.some((item) => item.label === "初 S以上")).toBe(true);
    expect(result.some((item) => item.label.includes("FC"))).toBe(false);
  });
});

let ownerSequence = 1000;
function fake(type: string, customId = "", values: string[] = [], userId = String(++ownerSequence), permissions = BigInt(0)) {
  const target = {
    commandName: "pulse", customId, values, user: { id: userId }, guildId: "123", channelId: "456",
    memberPermissions: new PermissionsBitField(permissions), client: { ws: { ping: 10 } }, replied: false, deferred: false,
    fields: { getTextInputValue: () => "test search", getUploadedFiles: () => ({ first: () => ({ id: "99", name: "sample.wav", url: "https://example.com/file", size: 100 }) }) },
    isChatInputCommand: () => type === "chat", isButton: () => type === "button", isStringSelectMenu: () => type === "string",
    isUserSelectMenu: () => false, isChannelSelectMenu: () => false, isRoleSelectMenu: () => false,
    isMessageComponent: () => type === "button" || type === "string", isModalSubmit: () => type === "modal", isFromMessage: () => true,
    reply: vi.fn(async (payload: unknown) => { target.replied = true; return payload; }),
    update: vi.fn(async (payload: unknown) => payload), editReply: vi.fn(async (payload: unknown) => payload),
    deferReply: vi.fn(async () => { target.deferred = true; }), deferUpdate: vi.fn(async () => { target.deferred = true; }),
    showModal: vi.fn(async (payload: unknown) => { target.replied = true; return payload; }), followUp: vi.fn(async () => {}),
  };
  return target;
}
type Fake = ReturnType<typeof fake>;
function payload(target: Fake) {
  const calls = [...target.reply.mock.calls, ...target.update.mock.calls, ...target.editReply.mock.calls];
  return calls.at(-1)![0] as { components: { toJSON: () => { components: { custom_id: string; options?: { value: string }[] }[] } }[] };
}
function component(target: Fake, operation: string) {
  return payload(target).components.flatMap((row) => row.toJSON().components).find((item) => item.custom_id?.endsWith(`:${operation}`))!.custom_id;
}
const context = {} as Parameters<typeof handlePulseInteraction>[1];
async function dispatch(target: Fake) { await handlePulseInteraction(target as unknown as Interaction, context); return target; }
async function choose(actionId: string, permissions = BigInt(0)) {
  const start = await dispatch(fake("chat", "", [], undefined, permissions));
  const selected = await dispatch(fake("string", component(start, "action"), [actionId], start.user.id, permissions));
  return selected;
}
describe("interactive menu flow", () => {
  it("edits a text input and dispatches the real legacy function", async () => {
    const chosen = await choose("osu/link");
    const field = await dispatch(fake("string", component(chosen, "field"), ["username"], chosen.user.id));
    const modal = field.showModal.mock.calls[0][0] as { data: { custom_id: string } };
    const submitted = await dispatch(fake("modal", modal.data.custom_id, [], chosen.user.id));
    const run = await dispatch(fake("button", component(submitted, "run"), [], chosen.user.id));
    expect(mocks.handle).toHaveBeenCalled();
    const adapted = mocks.handle.mock.calls.at(-1)![0] as unknown as { commandName: string; options: { getString: (name: string) => string; getSubcommand: () => string } };
    expect(adapted.commandName).toBe("osu"); expect(adapted.options.getSubcommand()).toBe("link");
    expect(adapted.options.getString("username")).toBe("test search");
    const before = mocks.handle.mock.calls.length;
    await dispatch(fake("button", run.customId, [], chosen.user.id));
    expect(mocks.handle.mock.calls.length).toBe(before);
  });
  it("does not dispatch administrator actions for regular users or stolen panels", async () => {
    const start = await dispatch(fake("chat"));
    const categoryOptions = payload(start).components[0].toJSON().components[0].options!;
    expect(categoryOptions.some((option) => option.value === "admin" || option.value === "operator")).toBe(false);
    const forged = await dispatch(fake("string", component(start, "action"), ["server-status/setup"], start.user.id));
    expect(component(forged, "action")).toBeTruthy();
    const stolen = await dispatch(fake("string", component(forged, "action"), ["osu/link"], "other"));
    expect(stolen.reply.mock.calls[0][0]).toMatchObject({ flags: MessageFlags.Ephemeral });
  });
  it("uses native file upload modals", async () => {
    const start = await dispatch(fake("chat"));
    const music = await dispatch(fake("string", component(start, "category"), ["music"], start.user.id));
    const selected = await dispatch(fake("string", component(music, "action"), ["music/upload"], start.user.id));
    const upload = pulseActions.find((item) => item.id === "music/upload")!.options.find((item) => item.type === 11)!;
    const field = await dispatch(fake("string", component(selected, "field"), [upload.name], start.user.id));
    const modal = field.showModal.mock.calls[0][0] as { toJSON: () => { components: { component: { type: number } }[] } };
    expect(modal.toJSON().components[0].component.type).toBe(19);
  });
  it("requires explicit confirmation for deletion and rechecks permissions", async () => {
    const selected = await choose("server-status/remove", PermissionFlagsBits.ManageGuild);
    const confirm = await dispatch(fake("button", component(selected, "run"), [], selected.user.id, PermissionFlagsBits.ManageGuild));
    expect(component(confirm, "confirm")).toBeTruthy();
    const before = mocks.handle.mock.calls.length;
    await dispatch(fake("button", component(confirm, "confirm"), [], selected.user.id));
    expect(mocks.handle.mock.calls.length).toBe(before);
  });
  it("keeps the native button response state and methods when adapting", async () => {
    const native = fake("button");
    const action = pulseActions.find((item) => item.root === "ping")!;
    const adapted = pulseCommandInteraction(native as never, action, {});
    await adapted.reply("hello");
    expect(native.reply.mock.calls[0][0]).toMatchObject({ content: "hello", flags: 0 });
    expect(adapted.replied).toBe(true);
    expect(native.commandName).toBe("pulse");
  });
  it("preserves public music/render panels for long-running message updates", async () => {
    const native = fake("button");
    const action = pulseActions.find((item) => item.id === "music/play")!;
    const adapted = pulseCommandInteraction(native as never, action, {});
    await adapted.reply("playback");
    expect(native.reply.mock.calls[0][0]).toMatchObject({ content: "playback", flags: 0 });
  });
  it("makes normal results public even if an old handler requests ephemeral", async () => {
    for (const actionId of ["ping", "osu/profile", "goal/status", "extra/stability", "music/play", "render"]) {
      const action = pulseActions.find((item) => item.id === actionId)!;
      expect(pulseResultIsPrivate(action)).toBe(false);
      const native = fake("button");
      const adapted = pulseCommandInteraction(native as never, action, {});
      await adapted.reply({ content: "result", flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds });
      expect(native.reply.mock.calls[0][0]).toMatchObject({ flags: MessageFlags.SuppressEmbeds });
      await adapted.deferReply({ flags: MessageFlags.Ephemeral });
      expect(native.deferReply.mock.calls.at(-1)).toEqual([{ flags: 0 }]);
    }
  });
  it("keeps authentication, operator data, private exports and reminders private", async () => {
    for (const actionId of ["osu/link", "extra/storage", "extra/workers", "overlay/setup", "export", "remind/list"]) {
      const action = pulseActions.find((item) => item.id === actionId)!;
      expect(pulseResultIsPrivate(action)).toBe(true);
      const native = fake("button");
      const adapted = pulseCommandInteraction(native as never, action, {});
      await adapted.reply("private data");
      expect(native.reply.mock.calls[0][0]).toMatchObject({ flags: MessageFlags.Ephemeral });
    }
  });
});
