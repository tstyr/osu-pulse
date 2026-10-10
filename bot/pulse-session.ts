import { randomBytes } from "node:crypto";
export type PulseSession = {
  id: string; owner: string; guild: string | null; channel: string | null;
  revision: number; expires: number; category: string; page: number;
  action?: string; option?: string; confirming?: boolean; values: Record<string, unknown>;
};
export class PulseSessionStore {
  private sessions = new Map<string, PulseSession>();
  constructor(private readonly now = () => Date.now(), private readonly maximum = 1000) {}
  create(owner: string, guild: string | null, channel: string | null) {
    for (const [key, value] of this.sessions) if (value.expires <= this.now()) this.sessions.delete(key);
    while (this.sessions.size >= this.maximum) this.sessions.delete(this.sessions.keys().next().value!);
    const session: PulseSession = { id: randomBytes(9).toString("hex"), owner, guild, channel, revision: 0,
      expires: this.now() + 3_600_000, category: "osu", page: 0, values: {} };
    this.sessions.set(session.id, session);
    return session;
  }
  get(id: string, owner: string, guild: string | null, channel: string | null) {
    const session = this.sessions.get(id);
    if (!session || session.expires <= this.now()) { this.sessions.delete(id); return null; }
    if (session.owner !== owner || session.guild !== guild || session.channel !== channel) return null;
    session.expires = this.now() + 3_600_000;
    return session;
  }
  claim(session: PulseSession, revision: number) {
    if (session.revision !== revision) return false;
    session.revision++;
    return true;
  }
}
