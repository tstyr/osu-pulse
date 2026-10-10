import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardOverview } from "../../lib/control/dashboard";
import { OverviewDashboard } from "./overview-dashboard";

vi.mock("swr", () => ({ default: (_key: string, _fetcher: unknown, options: { fallbackData: unknown }) => ({ data: options.fallbackData, mutate: vi.fn(), isValidating: false }) }));
vi.mock("@/lib/client/request-json", () => ({ liveRequestOptions: {}, requestJson: vi.fn() }));
vi.mock("@/components/control-panel/refresh-notice", () => ({ RefreshNotice: () => null }));

function overview() {
  // Only display fields are needed; diagnostics metadata stays outside this fixture.
  return {
    databaseProvider: "Local PostgreSQL",
    renderer: {
      online: true, status: "ready", activeCount: 0, capacity: 1, encoder: "libx264",
      lastSeenAt: null, cloudQueue: 0, configurationVersion: 6, restartRequired: false,
      storage: { available: true, songsAvailable: true, outputAvailable: true },
      youtube: { authStatus: "ready", pendingCount: 0, enabled: true, configured: true },
      startPolicy: { allowed: true },
    },
    renders: { total: 0, active: 0, completed: 0, successRate: 100, youtubeUploaded: 0, localVideoCount: 0, localVideoBytes: 0 },
    community: { discordLinks: 40, osuAccounts: 40, guilds: 3 },
    system: { cpuPercent: 12, gpuPercent: null, memoryPercent: 35, memoryUsedBytes: 1024, memoryTotalBytes: 4096, diskPercent: 25, diskAvailable: true, diskUsedBytes: 1024, diskTotalBytes: 4096 },
    trend: [{ date: "2026-10-10", total: 0, completed: 0, failed: 0 }], recentJobs: [],
  } as unknown as DashboardOverview;
}

describe("overview presentation", () => {
  it("keeps the real zero state, labeled chart, and all resource sections", () => {
    const html = renderToStaticMarkup(<OverviewDashboard initial={overview()} />);
    expect(html).toContain("この期間のレンダー記録はありません");
    expect(html).toContain('height:0%');
    expect(html).toContain('aria-label="直近14日のレンダー総数 0本');
    expect(html).toContain("現在の値を取得できません");
    expect(html).toContain("まだレンダー履歴がありません");
    expect(html.match(/scope="col"/g)).toHaveLength(4);
    for (const label of ["CPU", "GPU", "Memory", "Disk", "Local PostgreSQL"]) expect(html).toContain(label);
  });

  it("retains the disconnected renderer warning rather than displaying false zeros", () => {
    const data = overview();
    data.renderer.online = false;
    const html = renderToStaticMarkup(<OverviewDashboard initial={data} />);
    expect(html).toContain("Rendererとの通信がありません");
    expect(html).toContain("停止・未接続");
    expect(html).toContain("ローカル動画：Renderer未接続");
  });

  it("keeps storage and YouTube recovery guidance and links", () => {
    const data = overview();
    data.renderer.storage.available = false;
    data.renderer.youtube.authStatus = "reauthorization_required";
    const html = renderToStaticMarkup(<OverviewDashboard initial={data} />);
    expect(html).toContain("USB保存先に接続できません");
    expect(html).toContain("YouTubeの再認証が必要です");
    expect(html).toContain('href="/dashboard/settings"');
    expect(html).toContain('href="/dashboard/render"');
  });
});
