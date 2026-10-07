export const BOT_CARD_IDS = ["receivedBytes", "sentBytes", "gatewayPingMs", "voiceMembers", "osuActivePlayers", "messageCount", "dbBytes", "diskUsedBytes"] as const;
export type BotCardId = typeof BOT_CARD_IDS[number];
export type BotCardLayout = { order: BotCardId[]; favorites: BotCardId[] };
export const BOT_CARD_LAYOUT_KEY = "osu-pulse-bot-card-layout-v1";

export function normalizeBotCardLayout(value: unknown): BotCardLayout {
  const source = value && typeof value === "object" ? value as Partial<BotCardLayout> : {};
  const valid = (items: unknown) => Array.isArray(items)
    ? [...new Set(items.filter((item): item is BotCardId => BOT_CARD_IDS.includes(item as BotCardId)))] : [];
  return { order: [...valid(source.order), ...BOT_CARD_IDS.filter((key) => !valid(source.order).includes(key))], favorites: valid(source.favorites) };
}

export function botCardDisplayOrder(layout: BotCardLayout, visible: readonly BotCardId[]) {
  return [...layout.order.filter((key) => visible.includes(key) && layout.favorites.includes(key)),
    ...layout.order.filter((key) => visible.includes(key) && !layout.favorites.includes(key))];
}

export function moveBotCard(layout: BotCardLayout, card: BotCardId, direction: -1 | 1, visible: readonly BotCardId[]) {
  const peers = botCardDisplayOrder(layout, visible).filter((key) => layout.favorites.includes(key) === layout.favorites.includes(card));
  const neighbor = peers[peers.indexOf(card) + direction];
  if (!neighbor) return layout;
  const order = [...layout.order];
  const index = order.indexOf(card), next = order.indexOf(neighbor);
  if (index < 0 || next < 0) return layout;
  [order[index], order[next]] = [order[next], order[index]];
  return { ...layout, order };
}

export function toggleBotCardFavorite(layout: BotCardLayout, card: BotCardId): BotCardLayout {
  return { ...layout, favorites: layout.favorites.includes(card) ? layout.favorites.filter((key) => key !== card) : [...layout.favorites, card] };
}
