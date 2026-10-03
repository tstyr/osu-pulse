import { expect, it } from "vitest";
import { commands } from "./commands";
import { helpReply } from "./help-guide";

it("lists every registered slash command in a guide within Discord limits", () => {
  const fields = [];
  for (const section of ["osu", "render", "music", "tools", "admin"]) {
    const reply = helpReply(section);
    const embed = reply.embeds[0].toJSON();
    expect(reply.embeds[0].length).toBeLessThanOrEqual(6000);
    expect(embed.fields!.length).toBeLessThanOrEqual(25);
    fields.push(...embed.fields!.map((field) => field.name));
  }
  for (const command of commands.filter((command) => "description" in command)) {
    expect(fields).toContain(`/${command.name}`);
  }
});
