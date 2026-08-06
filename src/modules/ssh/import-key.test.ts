import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DefaultPrivateKeyImportService,
  detectKeyFormat,
  MAX_KEY_MATERIAL_BYTES,
} from "@/modules/ssh/import-key";
import { isKeyImportError } from "@/modules/ssh/errors";
import {
  AesGcmSecretEncryptionService,
  serializeEncryptedSecret,
  deserializeEncryptedSecret,
} from "@/modules/ssh/secrets";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function hasPuttygen(): boolean {
  return spawnSync("puttygen", ["-h"], { encoding: "utf8" }).status === 0;
}

describe("detectKeyFormat", () => {
  it("detects PPK / OpenSSH / PEM headers", () => {
    expect(
      detectKeyFormat("PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n"),
    ).toBe("ppk");
    expect(
      detectKeyFormat("-----BEGIN OPENSSH PRIVATE KEY-----\naaa\n-----END-----"),
    ).toBe("openssh");
    expect(
      detectKeyFormat("-----BEGIN RSA PRIVATE KEY-----\naaa\n-----END-----"),
    ).toBe("pem");
    expect(detectKeyFormat("not-a-key")).toBe("unknown");
  });
});

describe("DefaultPrivateKeyImportService", () => {
  const importer = new DefaultPrivateKeyImportService();
  let tmpDir: string;
  let opensshKey: string;
  let encryptedOpensshKey: string;
  let ppkUnencrypted: string | null = null;
  let ppkEncrypted: string | null = null;
  let ppkEncryptedRsa: string | null = null;
  let ppkEncryptedEcdsa: string | null = null;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-import-"));
    const plainPath = path.join(tmpDir, "id_ed25519");
    const encPath = path.join(tmpDir, "id_ed25519_enc");

    const plain = spawnSync(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-f", plainPath, "-q"],
      { encoding: "utf8" },
    );
    expect(plain.status).toBe(0);
    opensshKey = fs.readFileSync(plainPath, "utf8");

    const enc = spawnSync(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "pem-secret", "-f", encPath, "-q"],
      { encoding: "utf8" },
    );
    expect(enc.status).toBe(0);
    encryptedOpensshKey = fs.readFileSync(encPath, "utf8");

    if (hasPuttygen()) {
      const ppkPath = path.join(tmpDir, "plain.ppk");
      const encPpkPath = path.join(tmpDir, "enc.ppk");
      const passFile = path.join(tmpDir, "pass.txt");
      fs.writeFileSync(passFile, "ppk-secret");

      expect(
        spawnSync("puttygen", [plainPath, "-O", "private", "-o", ppkPath], {
          encoding: "utf8",
        }).status,
      ).toBe(0);
      ppkUnencrypted = fs.readFileSync(ppkPath, "utf8");

      expect(
        spawnSync(
          "puttygen",
          [
            plainPath,
            "-O",
            "private",
            "-o",
            encPpkPath,
            "--new-passphrase",
            passFile,
          ],
          { encoding: "utf8" },
        ).status,
      ).toBe(0);
      ppkEncrypted = fs.readFileSync(encPpkPath, "utf8");

      const rsaPath = path.join(tmpDir, "id_rsa");
      const rsaPpkPath = path.join(tmpDir, "enc_rsa.ppk");
      expect(
        spawnSync(
          "ssh-keygen",
          ["-t", "rsa", "-b", "2048", "-N", "", "-f", rsaPath, "-q"],
          { encoding: "utf8" },
        ).status,
      ).toBe(0);
      expect(
        spawnSync(
          "puttygen",
          [
            rsaPath,
            "-O",
            "private",
            "-o",
            rsaPpkPath,
            "--new-passphrase",
            passFile,
          ],
          { encoding: "utf8" },
        ).status,
      ).toBe(0);
      ppkEncryptedRsa = fs.readFileSync(rsaPpkPath, "utf8");

      const ecdsaPath = path.join(tmpDir, "id_ecdsa");
      const ecdsaPpkPath = path.join(tmpDir, "enc_ecdsa.ppk");
      expect(
        spawnSync(
          "ssh-keygen",
          ["-t", "ecdsa", "-b", "256", "-N", "", "-f", ecdsaPath, "-q"],
          { encoding: "utf8" },
        ).status,
      ).toBe(0);
      expect(
        spawnSync(
          "puttygen",
          [
            ecdsaPath,
            "-O",
            "private",
            "-o",
            ecdsaPpkPath,
            "--new-passphrase",
            passFile,
          ],
          { encoding: "utf8" },
        ).status,
      ).toBe(0);
      ppkEncryptedEcdsa = fs.readFileSync(ecdsaPpkPath, "utf8");
    }
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("imports OpenSSH private keys and normalizes them", async () => {
    const imported = await importer.importKey({ rawKeyMaterial: opensshKey });
    expect(imported.sourceFormat).toBe("openssh");
    expect(imported.algorithm).toBe("ed25519");
    expect(imported.fingerprintSha256).toMatch(/^SHA256:/);
    expect(imported.normalizedPem).toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("requires / validates passphrase for encrypted OpenSSH keys", async () => {
    await expect(
      importer.importKey({ rawKeyMaterial: encryptedOpensshKey }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        isKeyImportError(err) &&
        (err.code === "PASSPHRASE_REQUIRED" || err.code === "WRONG_PASSPHRASE" || err.code === "INVALID_KEY")
      );
    });

    await expect(
      importer.importKey({
        rawKeyMaterial: encryptedOpensshKey,
        passphrase: "wrong",
      }),
    ).rejects.toSatisfy((err: unknown) => isKeyImportError(err));

    const imported = await importer.importKey({
      rawKeyMaterial: encryptedOpensshKey,
      passphrase: "pem-secret",
    });
    expect(imported.algorithm).toBe("ed25519");
  });

  it("rejects unknown formats and oversized input", async () => {
    await expect(
      importer.importKey({ rawKeyMaterial: "hello" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });

    const huge = "x".repeat(MAX_KEY_MATERIAL_BYTES + 1);
    await expect(
      importer.importKey({ rawKeyMaterial: huge }),
    ).rejects.toMatchObject({ code: "KEY_TOO_LARGE" });
  });

  it("imports unencrypted and passphrase-protected PPK when puttygen is available", async () => {
    if (!ppkUnencrypted || !ppkEncrypted) {
      return;
    }

    const plain = await importer.importKey({ rawKeyMaterial: ppkUnencrypted });
    expect(plain.sourceFormat).toBe("ppk");
    expect(plain.fingerprintSha256).toMatch(/^SHA256:/);

    await expect(
      importer.importKey({ rawKeyMaterial: ppkEncrypted }),
    ).rejects.toSatisfy((err: unknown) => isKeyImportError(err));

    await expect(
      importer.importKey({
        rawKeyMaterial: ppkEncrypted,
        passphrase: "wrong-pass",
      }),
    ).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });

    const unlocked = await importer.importKey({
      rawKeyMaterial: ppkEncrypted,
      passphrase: "ppk-secret",
    });
    expect(unlocked.sourceFormat).toBe("ppk");
    expect(unlocked.normalizedPem).toContain("PRIVATE KEY");
  });

  it("imports encrypted RSA and ECDSA PPK (regression: PEM convert, not broken OpenSSH)", async () => {
    if (!ppkEncryptedRsa || !ppkEncryptedEcdsa) {
      return;
    }

    const rsa = await importer.importKey({
      rawKeyMaterial: ppkEncryptedRsa,
      passphrase: "ppk-secret",
    });
    expect(rsa.sourceFormat).toBe("ppk");
    expect(rsa.algorithm).toBe("rsa");
    expect(rsa.fingerprintSha256).toMatch(/^SHA256:/);
    expect(rsa.normalizedPem).toContain("PRIVATE KEY");

    const ecdsa = await importer.importKey({
      rawKeyMaterial: ppkEncryptedEcdsa,
      passphrase: "ppk-secret",
    });
    expect(ecdsa.sourceFormat).toBe("ppk");
    expect(ecdsa.algorithm).toBe("ecdsa");
    expect(ecdsa.fingerprintSha256).toMatch(/^SHA256:/);
    expect(ecdsa.normalizedPem).toContain("PRIVATE KEY");
  });

  it("encrypts imported key material for at-rest storage without leaking plaintext", async () => {
    const imported = await importer.importKey({ rawKeyMaterial: opensshKey });
    const crypto = new AesGcmSecretEncryptionService(TEST_KEY);
    const envelope = serializeEncryptedSecret(crypto.encrypt(imported.normalizedPem));
    expect(envelope).not.toContain("PRIVATE KEY");
    expect(envelope).not.toContain(imported.normalizedPem);
    const roundTrip = crypto.decrypt(deserializeEncryptedSecret(envelope));
    expect(roundTrip).toBe(imported.normalizedPem);
  });
});
