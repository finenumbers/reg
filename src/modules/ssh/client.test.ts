import { describe, expect, it } from "vitest";
import { Ssh2Client } from "@/modules/ssh/client";

describe("Ssh2Client.testConnection", () => {
  const client = new Ssh2Client();

  it("returns timeout/error for unreachable host without hanging forever", async () => {
    const outcome = await client.testConnection(
      {
        host: "127.0.0.1",
        port: 1,
        username: "nobody",
        privateKeyPem:
          "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----\n",
      },
      2_000,
    );

    expect(["auth_error", "timeout", "error"]).toContain(outcome.result);
    expect(outcome.detail.toLowerCase()).not.toContain("private key");
    expect(outcome.detail).not.toMatch(/BEGIN/);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  }, 10_000);
});
