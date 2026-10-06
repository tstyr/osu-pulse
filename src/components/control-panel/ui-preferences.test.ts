import { describe, expect, it } from "vitest";
import { pageScaleSurfaceStyle, type UiScale } from "./ui-preferences";

describe("page scale sizing", () => {
  it.each([0.6, 0.7, 0.8, 0.9, 1] as UiScale[])("keeps %s zoom within the parent without double width compensation", (scale) => {
    expect(pageScaleSurfaceStyle(scale, false)).toEqual({ zoom: scale, width: "100%", minHeight: `${100 / scale}vh` });
  });
  it("keeps wide viewport mode unscaled", () => {
    expect(pageScaleSurfaceStyle(0.6, true)).toEqual({ zoom: 1, width: "100%", minHeight: "100vh" });
  });
});
