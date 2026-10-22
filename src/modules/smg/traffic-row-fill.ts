import { AF_CATEGORY } from "@/modules/smg-trace/classify";

/** One fill for a «Трафик SMG» row. Parking delay outranks «Заблокирован». */
export type SmgTrafficRowFill = "parking" | "blocked";

/**
 * A Parking reply millisecond paints gray, including `0` and a blocked call.
 * A timeout leaves the cell empty. Dev and Prod delays are not this cell.
 */
export function smgTrafficRowFill(
  antifraud: string,
  parkingDelay: string | null | undefined,
): SmgTrafficRowFill | null {
  if ((parkingDelay ?? "").trim() !== "") return "parking";
  if (antifraud === AF_CATEGORY.blocked) return "blocked";
  return null;
}
