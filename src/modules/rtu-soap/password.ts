/**
 * Opens the stored RTU password. Does not talk to the switch.
 * An empty or unreadable secret must not be sent.
 */
export function openRtuSoapPassword(
  ciphertext: string | null | undefined,
  decrypt: (serialized: string) => string,
): { ok: true; password: string } | { ok: false; code: "INCOMPLETE" | "DECRYPT_FAILED" } {
  if (!ciphertext) return { ok: false, code: "INCOMPLETE" };
  try {
    const password = decrypt(ciphertext);
    if (password.length === 0) return { ok: false, code: "DECRYPT_FAILED" };
    return { ok: true, password };
  } catch {
    return { ok: false, code: "DECRYPT_FAILED" };
  }
}
