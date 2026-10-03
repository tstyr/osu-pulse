import "server-only";

import { getDiscordActivitySummary, listCommunityEvents, listCommunityTickets } from "@/db/community-repository";
import { listAdminAudits } from "@/db/feature-repository";
import { getMusicPlaybackView } from "@/db/music-repository";
import { getPublicServiceStatus } from "@/db/advanced-features";
import { getDashboardOverview } from "@/lib/control/dashboard";
import { cachedAsync } from "@/lib/async-cache";

const readActivity = cachedAsync(() => getDiscordActivitySummary(30), 30_000);

async function buildCommandCenterView() {
  const [overview, services, music, activity, tickets, events, audits] = await Promise.all([
    getDashboardOverview(),
    getPublicServiceStatus(),
    getMusicPlaybackView(),
    readActivity(),
    listCommunityTickets(30),
    listCommunityEvents(30),
    listAdminAudits(30),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    overview,
    services,
    music,
    activity,
    tickets: tickets.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    })),
    events: events.map((row) => ({
      ...row,
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    audits: audits.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

export const getCommandCenterView = cachedAsync(buildCommandCenterView, 3_000);
export type CommandCenterView = Awaited<ReturnType<typeof getCommandCenterView>>;
