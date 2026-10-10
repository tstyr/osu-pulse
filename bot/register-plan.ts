type Definition = { name: string; type?: number; [key: string]: unknown };
export function registrationBody(definitions: Definition[]) {
  const keys = new Set(["name", "description", "type", "options", "default_member_permissions", "dm_permission", "nsfw", "contexts", "integration_types", "name_localizations", "description_localizations"]);
  return definitions.map((definition) => Object.fromEntries(Object.entries(definition).filter(([key]) => keys.has(key))));
}
export function assertKnownRegistration(existing: Definition[], knownNames: Set<string>) {
  const unknown = existing.filter((command) => !knownNames.has(command.name));
  if (unknown.length) throw new Error("UNRECOGNIZED_COMMANDS: refusing to overwrite registrations not in this application's catalog");
}
