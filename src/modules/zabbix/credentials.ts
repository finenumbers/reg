import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import type { ZabbixSlotRequest } from "@/modules/zabbix/session";
import { parseZabbixApiUrl } from "@/modules/zabbix/url";

export type ZabbixRuntime = {
  url: string;
  user: string;
  password: string;
  /** Ciphertext is stored but the master key cannot open it. */
  broken: boolean;
  slots: ZabbixSlotRequest[];
};

function slot(
  host: string | null | undefined,
  name: string | null | undefined,
  title: string | null | undefined,
  index: 1 | 2,
): ZabbixSlotRequest | null {
  const hostText = host?.trim() ?? "";
  const nameText = name?.trim() ?? "";
  if (!hostText || !nameText) return null;
  return { slot: index, host: hostText, name: nameText, title: title?.trim() ?? "" };
}

export async function loadZabbixRuntime(): Promise<ZabbixRuntime> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const url = parseZabbixApiUrl(settings?.zabbixApiUrl ?? "") ?? "";
  const user = settings?.zabbixUser?.trim() ?? "";
  let password = "";
  let broken = false;
  if (settings?.zabbixPasswordCiphertext) {
    try {
      password = getSecretEncryptionService().decrypt(
        deserializeEncryptedSecret(settings.zabbixPasswordCiphertext),
      );
    } catch {
      broken = true;
      password = "";
    }
  }
  const slots = [
    slot(settings?.zabbixGraph1Host, settings?.zabbixGraph1Name, settings?.zabbixGraph1Title, 1),
    slot(settings?.zabbixGraph2Host, settings?.zabbixGraph2Name, settings?.zabbixGraph2Title, 2),
  ].filter((item): item is ZabbixSlotRequest => item != null);
  return { url, user, password, broken, slots };
}

export function zabbixRuntimeReady(runtime: ZabbixRuntime): boolean {
  return Boolean(runtime.url && runtime.user && runtime.password && runtime.slots.length > 0);
}
