import { prisma } from "@/lib/db";

/**
 * True only when a syslog node is explicitly off and its identifier is this
 * «Узел». The comparison is `identifier = lower(btrim(device_sign))`, the same
 * predicate the answer and delay charts use. A missing row is not off.
 */
export async function smgNodeAntifraudOff(deviceSign: string): Promise<boolean> {
  const device = deviceSign.trim().toLowerCase();
  if (!device) return false;
  const row = await prisma.smgSyslogNode.findFirst({
    where: { antifraudEnabled: false, identifier: device },
    select: { ip: true },
  });
  return row != null;
}
