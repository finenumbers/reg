import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import { parseRtuSoapOrigin } from "@/modules/rtu-soap/origin";
import { openRtuSoapPassword } from "@/modules/rtu-soap/password";

export async function loadRtuSoapAccount(): Promise<
  | { ok: true; origin: string; login: string; password: string; caPem: string | null }
  | { ok: false; code: "INCOMPLETE" | "DECRYPT_FAILED" }
> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const origin = settings?.rtuSoapBaseUrl
    ? parseRtuSoapOrigin(settings.rtuSoapBaseUrl)
    : null;
  const login = settings?.rtuSoapLogin?.trim() ?? "";
  if (!origin || !login) return { ok: false, code: "INCOMPLETE" };
  const opened = openRtuSoapPassword(
    settings?.rtuSoapPasswordCiphertext,
    (serialized) => {
      const encryption = getSecretEncryptionService();
      return encryption.decrypt(deserializeEncryptedSecret(serialized));
    },
  );
  if (!opened.ok) return opened;
  return {
    ok: true,
    origin,
    login,
    password: opened.password,
    caPem: settings?.rtuSoapCaPem ?? null,
  };
}
