export const SIP_TRUNK_PREFIXES = ["PSTN_", "Trunk_"] as const;
export const PLATFORM_PREFIXES = ["Service_", "Platform_"] as const;

export const STATS_DEVICE_PREFIXES = [
  ...SIP_TRUNK_PREFIXES,
  ...PLATFORM_PREFIXES,
] as const;

export type StatsKind = "sip" | "platform";

export type ClassifiedCallLeg = {
  kind: StatsKind;
  name: string;
  dir: "in" | "out";
};

export function isSipTrunk(name: string): boolean {
  return SIP_TRUNK_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isPlatform(name: string): boolean {
  return PLATFORM_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function classifyDevice(name: string): StatsKind | null {
  if (isSipTrunk(name)) return "sip";
  if (isPlatform(name)) return "platform";
  return null;
}

/** One CDR may yield 0–2 legs; each matching device is counted separately. */
export function classifyCallLegs(
  srcName: string,
  dstName: string,
): ClassifiedCallLeg[] {
  const legs: ClassifiedCallLeg[] = [];
  const srcKind = classifyDevice(srcName);
  if (srcKind) legs.push({ kind: srcKind, name: srcName, dir: "in" });
  const dstKind = classifyDevice(dstName);
  if (dstKind) legs.push({ kind: dstKind, name: dstName, dir: "out" });
  return legs;
}
