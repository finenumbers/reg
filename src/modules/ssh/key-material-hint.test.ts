import { describe, expect, it } from "vitest";
import { inspectKeyMaterial } from "@/modules/ssh/key-material-hint";

describe("inspectKeyMaterial", () => {
  it("detects encrypted PPK", () => {
    const raw = `PuTTY-User-Key-File-3: ssh-ed25519
Encryption: aes256-cbc
Comment: test
Public-Lines: 2
AAAA
Private-Lines: 1
AAAA
Private-MAC: deadbeef
`;
    expect(inspectKeyMaterial(raw)).toEqual({
      format: "ppk",
      encrypted: true,
    });
  });

  it("detects unencrypted PPK", () => {
    const raw = `PuTTY-User-Key-File-2: ssh-rsa
Encryption: none
Comment: test
`;
    expect(inspectKeyMaterial(raw)).toEqual({
      format: "ppk",
      encrypted: false,
    });
  });

  it("detects OpenSSH marker", () => {
    expect(
      inspectKeyMaterial("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n"),
    ).toMatchObject({ format: "openssh" });
  });
});
