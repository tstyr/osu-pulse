import { commands } from "../../../../bot/commands";
import { CommandGuide } from "@/components/control-panel/command-guide";
import { buildCommandCatalog } from "@/lib/discord/command-catalog";

export const metadata = { title: "コマンドガイド" };

export default function CommandsPage() {
  return <CommandGuide entries={buildCommandCatalog(commands)} />;
}
