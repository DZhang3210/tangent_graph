import { describe, expect, it } from "vitest";
import { boundsFor } from "../../desktop/geometry.mjs";

const area = { x: 0, y: 0, width: 1920, height: 1032 };

describe("window placement for page modes", () => {
  it("maximizes for full page", () => {
    expect(boundsFor("full", area)).toBe("maximize");
  });

  it("takes the right half of the work area for half page", () => {
    expect(boundsFor("half", area)).toEqual({ x: 960, y: 0, width: 960, height: 1032 });
  });

  it("takes the top-right quarter for quarter page", () => {
    expect(boundsFor("quarter", area)).toEqual({ x: 960, y: 0, width: 960, height: 516 });
  });

  it("stays inside a work area that doesn't start at 0,0 (second monitor, taskbar on top)", () => {
    expect(boundsFor("quarter", { x: -1280, y: 40, width: 1281, height: 985 }))
      .toEqual({ x: -639, y: 40, width: 640, height: 493 });
  });
});
