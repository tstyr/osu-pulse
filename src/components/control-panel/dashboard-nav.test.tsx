import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardBreadcrumb, DashboardNav } from "./dashboard-nav";

const preferences = vi.hoisted(() => ({ pathname: "/dashboard", locale: "ja" as "ja" | "en" }));
vi.mock("next/navigation", () => ({ usePathname: () => preferences.pathname }));
vi.mock("@/components/control-panel/ui-preferences", () => ({ useUiPreferences: () => preferences }));

describe("console navigation", () => {
  beforeEach(() => { preferences.pathname = "/dashboard"; preferences.locale = "ja"; });

  it("preserves all thirteen destinations and identifies exactly one current page", () => {
    const html = renderToStaticMarkup(<DashboardNav />);
    expect(html.match(/<a /g)).toHaveLength(13);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    for (const group of ["ワークスペース", "分析", "メディア", "管理"]) expect(html).toContain(group);
    for (const path of ["/dashboard/music", "/compare", "/dashboard/database", "/dashboard/settings"]) expect(html).toContain(`href="${path}"`);
  });

  it("recognizes nested routes without selecting similarly prefixed routes", () => {
    preferences.pathname = "/dashboard/music/library";
    expect(renderToStaticMarkup(<DashboardNav />).match(/aria-current="page"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<DashboardBreadcrumb />)).toContain("音楽");
    preferences.pathname = "/dashboard/music-other";
    expect(renderToStaticMarkup(<DashboardNav />)).not.toContain('aria-current="page"');
  });

  it("shows the active section and follows the existing language preference", () => {
    preferences.pathname = "/dashboard/performance";
    preferences.locale = "en";
    const html = renderToStaticMarkup(<DashboardBreadcrumb />);
    expect(html).toContain("Analytics");
    expect(html).toContain("Performance");
    expect(renderToStaticMarkup(<DashboardNav />)).toContain('aria-label="Console navigation"');
  });
});
