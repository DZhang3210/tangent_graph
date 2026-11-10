// Where the app window goes for each page mode, inside the screen's work area
// (the screen minus the taskbar). Pure, so it's tested without Electron.

/** @param {"full" | "half" | "quarter"} mode */
export function boundsFor(mode, area) {
  if (mode === "full") return "maximize";
  // Right side, so it sits next to whatever you're working in (editor, browser).
  const left = Math.round(area.width / 2);
  const width = area.width - left;
  const height = mode === "half" ? area.height : Math.round(area.height / 2);
  return { x: area.x + left, y: area.y, width, height };
}
