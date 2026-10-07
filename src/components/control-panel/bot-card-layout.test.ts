import { describe, expect, it } from "vitest";
import { BOT_CARD_IDS, botCardDisplayOrder, moveBotCard, normalizeBotCardLayout, toggleBotCardFavorite } from "./bot-card-layout";

describe("Bot statistics card layout", () => {
  it("repairs malformed saved layouts without losing cards", () => {
    expect(normalizeBotCardLayout(null).order).toEqual(BOT_CARD_IDS);
    const layout = normalizeBotCardLayout({ order: ["dbBytes", "dbBytes", "bad"], favorites: ["bad", "dbBytes"] });
    expect(layout.order[0]).toBe("dbBytes");
    expect(new Set(layout.order).size).toBe(BOT_CARD_IDS.length);
    expect(layout.favorites).toEqual(["dbBytes"]);
  });
  it("pins favorites first without moving hidden global cards into guild scope", () => {
    const layout = toggleBotCardFavorite(normalizeBotCardLayout({}), "dbBytes");
    expect(botCardDisplayOrder(layout, BOT_CARD_IDS)[0]).toBe("dbBytes");
    expect(botCardDisplayOrder(layout, ["gatewayPingMs", "voiceMembers"])).toEqual(["gatewayPingMs", "voiceMembers"]);
  });
  it("moves only amongst visible cards in the same pinned group", () => {
    const layout = normalizeBotCardLayout({ favorites: ["dbBytes"] });
    const moved = moveBotCard(layout, "voiceMembers", -1, ["gatewayPingMs", "voiceMembers", "dbBytes"]);
    expect(botCardDisplayOrder(moved, ["gatewayPingMs", "voiceMembers", "dbBytes"])).toEqual(["dbBytes", "voiceMembers", "gatewayPingMs"]);
    expect(moveBotCard(layout, "dbBytes", 1, BOT_CARD_IDS)).toBe(layout);
  });
  it("unpinning preserves the stored order and does not delete cards", () => {
    const layout = normalizeBotCardLayout({});
    expect(toggleBotCardFavorite(toggleBotCardFavorite(layout, "dbBytes"), "dbBytes")).toEqual(layout);
  });
});
