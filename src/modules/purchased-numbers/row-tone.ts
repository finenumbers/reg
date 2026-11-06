/**
 * DID purchased row order: a blocked endpoint, then «Нет в реестре»,
 * then «Не подключено», then «Внешняя нумерация».
 */

export type PurchasedRowTone = "blocked" | "red" | "yellow" | "blue" | "none";

export const PURCHASED_ROW_CLASS: Record<PurchasedRowTone, string> = {
  blocked: "bg-black text-white hover:bg-black hover:text-white",
  red: "bg-red-600 text-white hover:bg-red-600 hover:text-white",
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
  blocked?: boolean;
}): PurchasedRowTone {
  if (row.blocked) return "blocked";
  if (row.operator === NOT_IN_REGISTRY) return "blue";
  if (row.rtu_connected === RTU_NOT_CONNECTED) return "red";
  if (row.rtu_connected === RTU_EXTERNAL) return "yellow";
  return "none";
}
