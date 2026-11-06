import {
  anyNumberBlocked,
  type BlockedNumberIndex,
} from "@/modules/phones/blocked-numbers";

/** Stored calling, called, and redirecting numbers. Not the derived screen label. */
const SMG_BLOCKED_FIELDS = [
  "incomingCgpn",
  "outgoingCgpn",
  "incomingCdpn",
  "outgoingCdpn",
  "incomingRedirectingNumber",
  "outgoingRedirectingNumber",
] as const;

export type SmgBlockedNumberSource = Partial<
  Record<(typeof SMG_BLOCKED_FIELDS)[number] | "incomingIp", string | null>
>;

export function smgHasBlockedNumber(
  index: BlockedNumberIndex,
  row: SmgBlockedNumberSource,
): boolean {
  return anyNumberBlocked(
    index,
    SMG_BLOCKED_FIELDS.map((field) => row[field]),
  );
}
