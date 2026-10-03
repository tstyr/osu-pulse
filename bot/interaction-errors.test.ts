import { describe, expect, it, vi } from "vitest";
import { MessageFlags, type RepliableInteraction } from "discord.js";
vi.mock("../src/db/feature-repository", () => ({ recordBotError: vi.fn() }));
import { interactionErrorMessage, sendInteractionError } from "./interaction-errors";

function interaction(overrides = {}) {
  return { deferred: false, replied: false, ephemeral: null, isMessageComponent: () => false, isModalSubmit: () => false, reply: vi.fn().mockResolvedValue({}), editReply: vi.fn().mockResolvedValue({}), followUp: vi.fn().mockResolvedValue({}), ...overrides };
}

describe("interaction failure recovery", () => {
  it("does not disclose query parameters or secret URLs", () => {
    expect(interactionErrorMessage(new Error("Failed query: SELECT secret params: user-id"))).not.toContain("params");
    expect(interactionErrorMessage(new Error("失敗 https://host/?token=secret"))).not.toContain("secret");
    expect(interactionErrorMessage({ code: 10008 })).toContain("削除");
    expect(interactionErrorMessage({ code: 50013 })).toContain("権限");
  });
  it("leaves a shared component message intact", async () => {
    const source = interaction({ deferred: true, isMessageComponent: () => true });
    await sendInteractionError(source as unknown as RepliableInteraction, "error");
    expect(source.editReply).not.toHaveBeenCalled();
    expect(source.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });
  it("finishes a deferred private response rather than leaving it loading", async () => {
    const source = interaction({ deferred: true, ephemeral: true, isMessageComponent: () => true });
    await sendInteractionError(source as unknown as RepliableInteraction, "error");
    expect(source.editReply).toHaveBeenCalledOnce();
    expect(source.followUp).not.toHaveBeenCalled();
  });
  it("falls back to a private follow-up if the deferred response is deleted", async () => {
    const source = interaction({ deferred: true, ephemeral: false, editReply: vi.fn().mockRejectedValue({ code: 10008 }) });
    await sendInteractionError(source as unknown as RepliableInteraction, "error");
    expect(source.followUp).toHaveBeenCalledOnce();
  });
});
