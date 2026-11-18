/**
 * Saturated red for a call whose visible Calltrace leg has no RTP.
 * The OPRS unsuccessful tail stays black until that word is «Нет».
 */

import { RTP_ABSENT } from "@/modules/voipmonitor/legs";

export type RtpChrome = "off" | "row" | "tail";

export const RTP_ABSENT_FILL = "bg-red-600 text-white hover:bg-red-700 hover:text-white";

export const OPRS_FAILED_TAIL_BLACK =
  "bg-black text-white hover:bg-black hover:text-white";

/** Saturated blue for a non-empty «МАВ» cell on «Звонки в ОПРС». */
export const OPRS_MAV_FILL = "bg-blue-600 text-white hover:bg-blue-700 hover:text-white";

export function isRtpAbsent(rtp: string | undefined): boolean {
  return rtp === RTP_ABSENT;
}

export function oprsFailedTailFill(rtp: string | undefined): "red" | "black" {
  return isRtpAbsent(rtp) ? "red" : "black";
}
