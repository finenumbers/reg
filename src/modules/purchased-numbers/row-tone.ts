/**
 * DID purchased row order: «Нет в реестре», then «Не подключено», then
 * «Внешняя нумерация». Fills are the geography table shades already in REG.
 */

export type PurchasedRowTone = "red" | "yellow" | "blue" | "none";

export const PURCHASED_ROW_CLASS: Record<PurchasedRowTone, string> = {
  red: "bg-destructive/10 hover:bg-destructive/15",
  yellow: "bg-amber-400/25 hover:bg-amber-400/35",
  blue: "bg-sky-500/15 hover:bg-sky-500/25",
  none: "",
};

const NOT_IN_REGISTRY = "Нет в реестре";
const RTU_NOT_CONNECTED = "Не подключено";
const RTU_EXTERNAL = "Внешняя нумерация";

export function purchasedRowTone(row: {
  operator: string;
  rtu_connected: string;
}): PurchasedRowTone {
  if (row.operator === NOT_IN_REGISTRY) return "blue";
  if (row.rtu_connected === RTU_NOT_CONNECTED) return "red";
  if (row.rtu_connected === RTU_EXTERNAL) return "yellow";
  return "none";
}
