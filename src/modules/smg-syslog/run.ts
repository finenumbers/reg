import dgram from "node:dgram";
import { mkdirSync } from "node:fs";
import { logger } from "@/lib/logger";
import { syslogFileKey } from "@/modules/smg-syslog/bucket";
import { canonicalIpv4, looksLikeDockerBridge } from "@/modules/smg-syslog/ip";
import { frameDatagram } from "@/modules/smg-syslog/frame";
import {
  removePartialArchives,
  SyslogStore,
  type SyslogPacket,
} from "@/modules/smg-syslog/store";
import { privilegeDropTarget } from "@/modules/smg-syslog/privileges";
import { resetSyslogVolumeOnce } from "@/modules/smg-syslog/reset";
import { freeBytes, LOW_SPACE_BYTES, writeStatus } from "@/modules/smg-syslog/status";

const REGISTRY_MS = 1000;
const IDLE_MS = 15;
const RETRY_MS = 200;
const STATUS_MS = 5000;
const UNKNOWN_KEEP = 8;
/** Quiet shutdown returns after two idle pauses. A steady stream stops here. */
export const SHUTDOWN_DRAIN_MS = 5_000;
/** A dead socket exits once the queue is flushed, or after this long if disk writes fail. */
export const FATAL_SOCKET_EXIT_MS = 5_000;
export const RECV_BUFFER_BYTES = 16 * 1024 * 1024;

export function shutdownDrainContinues(idleStreak: number, elapsedMs: number): boolean {
  return idleStreak < 2 && elapsedMs < SHUTDOWN_DRAIN_MS;
}

export function fatalSocketShouldExit(input: {
  fatal: boolean;
  stopping: boolean;
  idle: boolean;
  failingForMs: number;
}): boolean {
  if (!input.fatal || input.stopping) return false;
  if (input.idle) return true;
  return input.failingForMs >= FATAL_SOCKET_EXIT_MS;
}

export type SyslogRegistry = {
  enabled: boolean;
  ips: Set<string>;
};

export type ReceiverOptions = {
  port: number;
  root: string;
  loadRegistry: () => Promise<SyslogRegistry>;
  /** Replaces the file fsync. Tests hold it open while more datagrams arrive. */
  syncFile?: (fd: number) => Promise<void>;
};

/** A registered gateway, or the Docker bridge that rewrote its source address. */
export function syslogSourceAccepted(ip: string, ips: ReadonlySet<string>): boolean {
  return ips.has(ip) || looksLikeDockerBridge(ip);
}

/**
 * UDP receiver. Known sources and the Docker bridge are appended and fsynced
 * as one batch. Disk waits on the libuv pool, so the socket keeps being read.
 * Other addresses are counted and dropped. Registry refresh and gzip never sit
 * in front of that write. The process stays up when reception is disabled.
 */
export async function runSyslogReceiver(
  options: ReceiverOptions,
): Promise<() => Promise<void>> {
  if (resetSyslogVolumeOnce(options.root)) logger.info("smg.syslog.volume_reset", {});
  mkdirSync(options.root, { recursive: true });
  removePartialArchives(options.root);

  const state: {
    registry: SyslogRegistry | null;
    socket: dgram.Socket | null;
  } = { registry: null, socket: null };
  let registryError: string | null = null;
  let nextRegistryAt = 0;
  let registryInflight: Promise<void> | null = null;
  const store = new SyslogStore(options.root, { syncFile: options.syncFile });
  let inbox: SyslogPacket[] = [];
  let held: SyslogPacket[] | null = null;
  let bindError: string | null = null;
  let listening = false;
  let bound = false;
  let droppedPrivileges = false;
  let stopping = false;
  let fatalSocket = false;
  let fatalSince: number | null = null;
  let unknownTotal = 0;
  let bridgeSeen = false;
  let recvBufferBytes: number | null = null;
  let lastStatusAt = 0;
  const unknown = new Map<string, number>();
  const lastPacket = new Map<string, string>();
  let accepted = 0;
  let wake: (() => void) | null = null;

  async function pullQueuedDatagrams(): Promise<void> {
    const started = Date.now();
    let idle = 0;
    while (shutdownDrainContinues(idle, Date.now() - started)) {
      const before = inbox.length;
      await sleep(5);
      if (inbox.length === before) idle += 1;
      else idle = 0;
    }
  }

  function armFatalSocket(): void {
    if (stopping || !droppedPrivileges) return;
    fatalSocket = true;
    if (fatalSince == null) fatalSince = Date.now();
  }

  function maybeExitFatalSocket(): void {
    const idle = inbox.length === 0 && held == null && !store.dirty();
    const failingForMs = fatalSince == null ? 0 : Date.now() - fatalSince;
    if (!fatalSocketShouldExit({ fatal: fatalSocket, stopping, idle, failingForMs })) return;
    process.exit(1);
  }

  function sleepOrWake(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }

  function rememberUnknown(ip: string): void {
    unknownTotal += 1;
    unknown.set(ip, (unknown.get(ip) ?? 0) + 1);
    if (unknown.size <= UNKNOWN_KEEP) return;
    const oldest = unknown.keys().next().value;
    if (oldest && oldest !== ip) unknown.delete(oldest);
  }

  function kickRegistry(): void {
    if (registryInflight) return;
    const now = Date.now();
    if (state.registry && now < nextRegistryAt) return;
    nextRegistryAt = now + REGISTRY_MS;
    registryInflight = options
      .loadRegistry()
      .then((next) => {
        state.registry = next;
        registryError = null;
      })
      .catch((error: unknown) => {
        registryError = error instanceof Error ? error.message : String(error);
        if (!state.registry) {
          logger.error("smg.syslog.registry_failed", { error: registryError });
        }
      })
      .finally(() => {
        registryInflight = null;
      });
  }

  function ensureSocket(): void {
    if (!state.registry?.enabled) {
      if (state.socket && droppedPrivileges) {
        listening = false;
        return;
      }
      if (state.socket) {
        state.socket.close();
        state.socket = null;
        listening = false;
        bound = false;
      }
      return;
    }
    if (state.socket) {
      if (bound) listening = true;
      return;
    }
    if (droppedPrivileges) {
      bindError =
        "Порт syslog закрылся после сброса прав. Пересоздайте контейнер приёмника.";
      listening = false;
      return;
    }
    const created = dgram.createSocket({
      type: "udp4",
      recvBufferSize: RECV_BUFFER_BYTES,
    });
    created.on("message", (msg, rinfo) => {
      if (!state.registry?.enabled) return;
      const ip = canonicalIpv4(rinfo.address);
      if (!ip) {
        rememberUnknown(rinfo.address);
        return;
      }
      if (msg.length === 0) return;
      inbox.push({ ip, payload: Buffer.from(msg), receivedAt: new Date() });
      wake?.();
    });
    created.on("error", (error) => {
      bindError = error.message;
      listening = false;
      bound = false;
      logger.error("smg.syslog.socket_error", { error: error.message });
      try {
        created.close();
      } catch {
        /* already closed */
      }
      if (state.socket === created) state.socket = null;
      armFatalSocket();
    });
    created.bind(options.port, "0.0.0.0", () => {
      const drop = privilegeDropTarget(
        process.getuid?.() ?? -1,
        process.env.SMG_SYSLOG_DROP_UID,
        process.env.SMG_SYSLOG_DROP_GID,
      );
      if (drop) {
        try {
          if (
            typeof process.setgid !== "function" ||
            typeof process.setuid !== "function"
          ) {
            throw new Error("setuid is not available");
          }
          process.setgid(drop.gid);
          process.setuid(drop.uid);
          droppedPrivileges = true;
        } catch (error) {
          logger.error("smg.syslog.drop_privileges_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          process.exit(1);
        }
      }
      bound = true;
      listening = true;
      bindError = null;
      try {
        recvBufferBytes = created.getRecvBufferSize();
      } catch {
        recvBufferBytes = null;
      }
      logger.info("smg.syslog.listening", { port: options.port, recvBufferBytes });
    });
    state.socket = created;
  }

  function absorbInbox(current: SyslogPacket[] | null): SyslogPacket[] | null {
    const registry = state.registry;
    if (!registry || inbox.length === 0) return current;
    const batch = inbox;
    inbox = [];
    const kept: SyslogPacket[] = [];
    for (const packet of batch) {
      if (!syslogSourceAccepted(packet.ip, registry.ips)) {
        rememberUnknown(packet.ip);
        continue;
      }
      if (!frameDatagram(packet.payload)) continue;
      kept.push(packet);
      lastPacket.set(packet.ip, packet.receivedAt.toISOString());
      if (looksLikeDockerBridge(packet.ip)) bridgeSeen = true;
      accepted += 1;
    }
    if (kept.length === 0) return current;
    return current ? current.concat(kept) : kept;
  }

  function blockedKeys(): Set<string> {
    const keys = new Set<string>();
    const queued = held ? held.concat(inbox) : inbox;
    for (const packet of queued) keys.add(syslogFileKey(packet.ip, packet.receivedAt));
    return keys;
  }

  function publishStatus(force: boolean): void {
    const now = Date.now();
    if (!force && now - lastStatusAt < STATUS_MS) return;
    lastStatusAt = now;
    const free = freeBytes(options.root);
    const unknownRows = [...unknown.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, UNKNOWN_KEEP)
      .map(([ip, count]) => ({ ip, count }));
    try {
      writeStatus(options.root, {
        enabled: state.registry?.enabled ?? false,
        listening,
        bindError: bindError ?? registryError,
        freeBytes: free,
        lowSpace: free != null && free < LOW_SPACE_BYTES,
        pendingRaw: store.countPendingRaw(new Date()),
        unknownTotal,
        unknown: unknownRows,
        lastPacket: Object.fromEntries(lastPacket),
        bridgeWarning: bridgeSeen,
        recvBufferBytes,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn("smg.syslog.status_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  async function stop(): Promise<void> {
    stopping = true;
    wake?.();
    await stopped;
  }

  void (async () => {
    while (!stopping) {
      maybeExitFatalSocket();
      kickRegistry();
      ensureSocket();
      if (store.dirty()) {
        try {
          await store.commit([]);
        } catch (error) {
          logger.warn("smg.syslog.write_retry", {
            error: error instanceof Error ? error.message : String(error),
          });
          await sleep(RETRY_MS);
          continue;
        }
      }
      held = absorbInbox(held);
      if (held && held.length > 0) {
        const batch = held;
        try {
          await store.commit(batch);
          held = null;
        } catch (error) {
          if (store.dirty()) held = null;
          logger.warn("smg.syslog.write_retry", {
            error: error instanceof Error ? error.message : String(error),
          });
          await sleep(RETRY_MS);
          continue;
        }
      }
      if (state.registry && inbox.length === 0 && !store.dirty() && !held) {
        try {
          await store.pumpGzipSlice(new Date(), blockedKeys());
        } catch (error) {
          logger.warn("smg.syslog.gzip_retry", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      publishStatus(false);
      if (stopping) break;
      maybeExitFatalSocket();
      if (inbox.length === 0 && !held && !store.dirty()) {
        await sleepOrWake(IDLE_MS);
      }
    }
    await pullQueuedDatagrams();
    const socket = state.socket;
    state.socket = null;
    listening = false;
    if (socket) socket.close();
    await sleep(0);
    try {
      if (store.dirty()) await store.commit([]);
      held = absorbInbox(held);
      if (held && held.length > 0) await store.commit(held);
    } catch (error) {
      logger.error("smg.syslog.shutdown_write_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await store.close();
    } catch (error) {
      logger.error("smg.syslog.shutdown_write_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    publishStatus(true);
    resolveStopped();
  })();

  return stop;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
