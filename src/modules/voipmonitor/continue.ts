import { prisma } from "@/lib/db";
import { hasVoipmonitorWork } from "@/modules/voipmonitor/count";

export type VoipmonitorContinueHint = {
  status: "success" | "failed";
  skipped?: boolean;
  hoursProcessed?: number;
};

/** Chain only after a successful job that actually ran a hour. */
export function shouldChainVoipmonitorMatch(
  result: VoipmonitorContinueHint | null | undefined,
): boolean {
  if (!result) return false;
  if (result.skipped) return false;
  if (result.status !== "success") return false;
  return (result.hoursProcessed ?? 0) >= 1;
}

/** Same Settings + backlog gates as the scheduler drain. */
export async function canEnqueueVoipmonitorMatch(
  isInFlight: () => boolean,
): Promise<boolean> {
  if (isInFlight()) return false;
  const settings = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      voipmonitorEnabled: true,
      voipmonitorApiUrl: true,
      voipmonitorUser: true,
      voipmonitorPasswordCiphertext: true,
      voipmonitorGuiUrl: true,
    },
  });
  if (
    !settings?.voipmonitorEnabled ||
    !settings.voipmonitorApiUrl?.trim() ||
    !settings.voipmonitorUser?.trim() ||
    !settings.voipmonitorPasswordCiphertext ||
    !settings.voipmonitorGuiUrl?.trim()
  ) {
    return false;
  }
  return hasVoipmonitorWork();
}
