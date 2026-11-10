export interface Area { x: number; y: number; width: number; height: number }
export function boundsFor(mode: "full" | "half" | "quarter", area: Area): "maximize" | Area;
