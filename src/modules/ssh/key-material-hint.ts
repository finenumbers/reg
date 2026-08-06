/**
 * Lightweight client-side hints for SSH key paste/upload UI.
 * Does not decrypt — only reads public PPK headers / PEM markers.
 */

export type KeyMaterialHint = {
  format: "ppk" | "openssh" | "pem" | "unknown";
  /** True when PPK Encryption header is not "none", or PEM looks encrypted */
  encrypted: boolean | null;
};

export function inspectKeyMaterial(raw: string): KeyMaterialHint {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { format: "unknown", encrypted: null };
  }

  if (/^PuTTY-User-Key-File-[23]:/im.test(trimmed)) {
    const enc = trimmed.match(/^Encryption:\s*(.+)$/im);
    const alg = enc?.[1]?.trim().toLowerCase() ?? "";
    return {
      format: "ppk",
      encrypted: alg !== "" && alg !== "none",
    };
  }

  if (/^-----BEGIN OPENSSH PRIVATE KEY-----/m.test(trimmed)) {
    // OpenSSH encryption is not reliably detectable from text alone without parsing.
    return { format: "openssh", encrypted: null };
  }

  if (
    /^-----BEGIN ENCRYPTED PRIVATE KEY-----/m.test(trimmed) ||
    /^Proc-Type:\s*4,ENCRYPTED/m.test(trimmed)
  ) {
    return { format: "pem", encrypted: true };
  }

  if (/^-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/m.test(trimmed)) {
    return { format: "pem", encrypted: null };
  }

  return { format: "unknown", encrypted: null };
}
