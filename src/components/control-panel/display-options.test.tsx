import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisplayOptions } from "./display-options";
import { UiPreferencesProvider } from "./ui-preferences";

describe("responsive display settings", () => {
  it("starts collapsed on mobile without removing any display controls", () => {
    const html = renderToStaticMarkup(<UiPreferencesProvider><DisplayOptions /></UiPreferencesProvider>);
    expect(html).toContain('aria-expanded="false"');
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}"`);
    for (const label of ["表示を縮小", "表示を拡大", "広域表示", "テーマ切替", "表示言語"]) expect(html).toContain(label);
  });
});
