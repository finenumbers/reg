import dgram from "node:dgram";
import { fsync as fsyncCallback, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bucketOf } from "@/modules/smg-syslog/bucket";
import { runSyslogReceiver, syslogSourceAccepted } from "@/modules/smg-syslog/run";

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
    const file = path.join(
      root,
      "127.0.0.1",
      bucket.year,
      bucket.month,
      bucket.day,
      bucket.hour,
      `${bucket.slot}.log`,
    );
    expect(readFileSync(file, "utf8")).toBe("hello-smg\n");
  });

  it("keeps writing while a later registry read never returns", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-syslog-recv-"));
    dirs.push(root);
    const port = 20000 + Math.floor(Math.random() * 20000);
    let calls = 0;
    const stop = await runSyslogReceiver({
      port,
      root,
      loadRegistry: () => {
        calls += 1;
        if (calls === 1)
          return Promise.resolve({ enabled: true, ips: new Set(["127.0.0.1"]) });
        return new Promise(() => {});
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      socket.send(Buffer.from("after-hang"), port, "127.0.0.1", (error) => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stop();
    const bucket = bucketOf(new Date(), 0);
    const file = path.join(
      root,
      "127.0.0.1",
      bucket.year,
      bucket.month,
      bucket.day,
      bucket.hour,
      `${bucket.slot}.log`,
    );
    expect(readFileSync(file, "utf8")).toBe("after-hang\n");
  });

  it("keeps datagrams that arrive while fsync waits", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "smg-syslog-recv-"));
    dirs.push(root);
    const port = 20000 + Math.floor(Math.random() * 20000);
    let holds = 0;
    let releaseHold: (() => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const stop = await runSyslogReceiver({
      port,
      root,
      loadRegistry: async () => ({
        enabled: true,
        ips: new Set(["127.0.0.1"]),
      }),
      syncFile: async (fd) => {
        holds += 1;
        if (holds === 1) {
          markEntered?.();
          await hold;
        }
        await new Promise<void>((resolve, reject) => {
          fsyncCallback(fd, (error) => (error ? reject(error) : resolve()));
        });
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const socket = dgram.createSocket("udp4");
    const send = (payload: string) =>
      new Promise<void>((resolve, reject) => {
        socket.send(Buffer.from(payload), port, "127.0.0.1", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    await send("A");
    await entered;
    await send("B");
    await send("C");
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseHold?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.close();
    await stop();
    const bucket = bucketOf(new Date(), 0);
    const file = path.join(
      root,
      "127.0.0.1",
      bucket.year,
      bucket.month,
      bucket.day,
      bucket.hour,
      `${bucket.slot}.log`,
    );
    expect(readFileSync(file, "utf8")).toBe("A\nB\nC\n");
  });

  it("accepts a registered address and the docker bridge, and rejects another", () => {
    const ips = new Set(["10.1.2.3"]);
    expect(syslogSourceAccepted("10.1.2.3", ips)).toBe(true);
    expect(syslogSourceAccepted("172.23.0.1", ips)).toBe(true);
    expect(syslogSourceAccepted("8.8.8.8", ips)).toBe(false);
  });
});
