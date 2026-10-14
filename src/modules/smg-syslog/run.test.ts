import dgram from "node:dgram";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bucketOf } from "@/modules/smg-syslog/bucket";
import { runSyslogReceiver } from "@/modules/smg-syslog/run";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("syslog receiver", () => {
  it("writes a datagram from a registered address and ignores another", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-syslog-recv-"));
    dirs.push(root);
    const port = 20000 + Math.floor(Math.random() * 20000);
    const stop = await runSyslogReceiver({
      port,
      root,
      loadRegistry: async () => ({
        enabled: true,
        offsetHours: 0,
        ips: new Set(["127.0.0.1"]),
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      socket.send(Buffer.from("hello-smg"), port, "127.0.0.1", (error) => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await stop();
    const bucket = bucketOf(new Date(), 0);
    const file = path.join(root, "127.0.0.1", bucket.year, bucket.month, bucket.day, bucket.hour, `${bucket.slot}.log`);
    expect(readFileSync(file, "utf8")).toContain("hello-smg\n");
  });
});
