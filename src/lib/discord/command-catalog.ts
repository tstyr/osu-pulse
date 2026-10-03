export type CommandGuideEntry = {
  command: string;
  group: string;
  description: string;
  admin: boolean;
  options: Array<{ name: string; description: string; required: boolean; choices: string[] }>;
};

type CommandDefinition = {
  name: string;
  description?: string;
  type?: number;
  required?: boolean;
  default_member_permissions?: string | null;
  choices?: Array<{ name: string }>;
  options?: CommandDefinition[];
};

export function buildCommandCatalog(commands: CommandDefinition[]): CommandGuideEntry[] {
  const entries: CommandGuideEntry[] = [];
  for (const root of commands) {
    if (!root.description) continue;
    const visit = (node: CommandDefinition, path: string) => {
      const subcommands = node.options?.filter((option) => option.type === 1 || option.type === 2) ?? [];
      if (subcommands.length) {
        subcommands.forEach((child) => visit(child, `${path} ${child.name}`));
        return;
      }
      entries.push({
        command: path, group: root.name, description: node.description ?? "", admin: Boolean(root.default_member_permissions),
        options: (node.options ?? []).map((option) => ({ name: option.name, description: option.description ?? "", required: Boolean(option.required), choices: option.choices?.map((choice) => choice.name) ?? [] })),
      });
    };
    visit(root, `/${root.name}`);
  }
  return entries;
}
