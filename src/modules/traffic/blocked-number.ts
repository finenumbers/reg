import {
  anyNumberBlocked,
  type BlockedNumberIndex,
} from "@/modules/phones/blocked-numbers";

/** Calling, called, billing, original, external, and authenticated numbers. */
export const CDR_BLOCKED_FIELDS = [
  "inAni",
  "inDnis",
  "outAni",
  "outDnis",
  "billAni",
  "billDnis",
  "inOrigDnis",
  "outOrigDnis",
  "extAni",
  "extDnis",
  "authDnis",
] as const;

export type CdrBlockedNumberSource = Partial<
  Record<
    (typeof CDR_BLOCKED_FIELDS)[number] | "srcUser" | "dstUser" | "radiusUser",
    string | null
  >
>;

export function cdrHasBlockedNumber(
  index: BlockedNumberIndex,
  row: CdrBlockedNumberSource,
): boolean {
  return anyNumberBlocked(
    index,
    CDR_BLOCKED_FIELDS.map((field) => row[field]),
  );
}
