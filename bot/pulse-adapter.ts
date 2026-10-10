import { MessageFlags, type ChatInputCommandInteraction, type ButtonInteraction } from "discord.js";
import type { PulseAction } from "./pulse-catalog";

/** Reuse handlers with a fresh component response token. Never mutate the real interaction. */
export function pulseCommandInteraction(interaction: ButtonInteraction, action: PulseAction, values: Record<string, unknown>) {
  const get = (name: string, required = false) => {
    const value = values[name] ?? null;
    if (required && value === null) throw new Error(`Missing required option: ${name}`);
    return value;
  };
  const options = {
    data: action.options.filter((option) => values[option.name] != null).map((option) => ({ name: option.name, type: option.type, value: values[option.name] })),
    getString: get, getInteger: get, getNumber: get, getBoolean: get, getUser: get, getMember: get,
    getChannel: get, getRole: get, getAttachment: get,
    getSubcommand: () => action.path.at(-1) ?? null,
    getSubcommandGroup: () => action.path.length > 1 ? action.path[0] : null,
  };
  // Use an overlay so telemetry wrappers cannot mutate the underlying response methods.
  const overlay: Record<string | symbol, unknown> = { commandName: action.root, options };
  return new Proxy(overlay, {
    get(target, property) {
      if (Reflect.has(target, property)) return Reflect.get(target, property);
      const value = Reflect.get(interaction, property);
      if (property === "reply" || property === "deferReply") {
        // Long-lived music/render panels must keep their existing visibility:
        // their updaters use the normal bot message API, not an expiring token.
        if (action.root === "music" || action.root.startsWith("render")) return value.bind(interaction);
        return (payload: unknown = {}) => {
          const normalized = typeof payload === "string" ? { content: payload } : payload as Record<string, unknown>;
          return Reflect.apply(value, interaction, [{ ...normalized, flags: MessageFlags.Ephemeral }]);
        };
      }
      return typeof value === "function" ? value.bind(interaction) : value;
    },
  }) as unknown as ChatInputCommandInteraction;
}
