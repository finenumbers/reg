import dgram from "node:dgram";
import { mkdirSync } from "node:fs";
import { TZ_OFFSET_HOURS, resolveDisplayTimezone } from "@/lib/display-timezone";
import { logger } from "@/lib/logger";
import { canonicalIpv4, looksLikeDockerBridge } from "@/modules/smg-syslog/ip";
import { frameDatagram } from "@/modules/smg-syslog/frame";
import { removePartialArchives, SyslogStore, type SyslogPacket } from "@/modules/smg-syslog/store";
import { freeBytes, LOW_SPACE_BYTES, writeStatus } from "@/modules/smg-syslog/status";

const REGISTRY_MS = 1000;
const IDLE_MS = 15;
const RETRY_MS = 200;
const UNKNOWN_KEEP = 8;
const RECV_BUFFER = 16 * 1024 * 1024;

export type SyslogRegistry = {
  enabled: boolean;
  offsetHours: number;
  ips: Set<string>;
};

export type ReceiverOptions = {
  port: number;
  root: string;
  loadRegistry: () => Promise<SyslogRegistry>;
};

/**
 * UDP receiver. Known-source datagrams are appended and fsynced as one batch
 * of whatever the socket already delivered. Unknown sources are counted and
 * dropped. The process stays up when reception is disabled.
 */
export async function runSyslogReceiver(options: ReceiverOptions): Promise<() => Promise<void>> {
  mkdirSync(options.root, { recursive: true });
  removePartialArchives(options.root);

  const state: {
    registry: SyslogRegistry | null;
    socket: dgram.Socket | null;
  } = { registry: null, socket: null };
  let registryError: string | null = null;
  let nextRegistryAt = 0;
  const store = new SyslogStore(options.root, () => state.registry?.offsetHours ?? 3);
  let inbox: SyslogPacket[] = [];
  let held: SyslogPacket[] | null = null;
  let bindError: string | null = null;
  let listening = false;
  let stopping = false;
  let unknownTotal = 0;
  const unknown = new Map<string, number>();
  const lastPacket = new Map<string, string>();
  let accepted = 0;
  let wake: (() => void) | null = null;

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

  async function refreshRegistry(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && state.registry && now < nextRegistryAt) return;
    nextRegistryAt = now + REGISTRY_MS;
    try {
      const next = await options.loadRegistry();
      state.registry = next;
      registryError = null;
    } catch (error) {
      registryError = error instanceof Error ? error.message : String(error);
      if (!state.registry) {
        logger.error("smg.syslog.registry_failed", { error: registryError });
      }
    }
  }

  function ensureSocket(): void {
    if (!state.registry?.enabled) {
      if (state.socket) {
        state.socket.close();
        state.socket = null;
        listening = false;
      }
      return;
    }
    if (state.socket) return;
    const created = dgram.createSocket({
      type: "udp4",
      recvBufferSize: RECV_BUFFER,
    });
    created.on("message", (msg, rinfo) => {
      const ip = canonicalIpv4(rinfo.address);
      if (!ip) {
        rememberUnknown(rinfo.address);
        return;
      }
      inbox.push({ ip, payload: Buffer.from(msg) });
      wake?.();
    });
    created.on("error", (error) => {
      bindError = error.message;
      listening = false;
      logger.error("smg.syslog.socket_error", { error: error.message });
      try {
        created.close();
      } catch {
        /* already closed */
      }
      if (state.socket === created) state.socket = null;
    });
    created.bind(options.port, "0.0.0.0", () => {
      listening = true;
      bindError = null;
      logger.info("smg.syslog.listening", { port: options.port });
    });
    state.socket = created;
  }

  function publishStatus(): void {
    const free = freeBytes(options.root);
    const unknownRows = [...unknown.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, UNKNOWN_KEEP)
      .map(([ip, count]) => ({ ip, count }));
    const bridgeWarning =
      (state.registry?.ips.size ?? 0) > 0 &&
      accepted === 0 &&
      unknownRows.some((row) => looksLikeDockerBridge(row.ip));
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
        bridgeWarning,
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
      await refreshRegistry(state.registry == null);
      ensureSocket();
      if (store.dirty() || held) {
        try {
          store.commit(held ?? [], new Date());
          held = null;
        } catch (error) {
          if (!store.dirty()) {
            /* write rolled back; held stays for a retry */
          } else {
            held = null;
          }
          logger.warn("smg.syslog.write_retry", {
            error: error instanceof Error ? error.message : String(error),
          });
          await sleep(RETRY_MS);
          continue;
        }
      }
      if (inbox.length > 0 && state.registry?.enabled) {
        const batch = inbox;
        inbox = [];
        const known: SyslogPacket[] = [];
        const ips = state.registry.ips;
        for (const packet of batch) {
          if (!ips.has(packet.ip)) {
            rememberUnknown(packet.ip);
            continue;
          }
          if (!frameDatagram(packet.payload)) continue;
          known.push(packet);
          lastPacket.set(packet.ip, new Date().toISOString());
          accepted += 1;
        }
        if (known.length > 0) {
          held = known;
          continue;
        }
      }
      if (state.registry) {
        try {
          await store.pumpGzipSlice(new Date());
        } catch (error) {
          logger.warn("smg.syslog.gzip_retry", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      publishStatus();
      if (stopping) break;
      if (inbox.length === 0 && !held && !store.dirty()) {
        await sleepOrWake(IDLE_MS);
      }
    }
    try {
      if (store.dirty()) store.commit([], new Date());
      else if (held) store.commit(held, new Date());
      const current = state.registry;
      if (current?.enabled && inbox.length > 0) {
        const known = inbox.filter(
          (packet) => current.ips.has(packet.ip) && frameDatagram(packet.payload),
        );
        if (known.length > 0) store.commit(known, new Date());
      }
    } catch (error) {
      logger.error("smg.syslog.shutdown_write_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    store.close();
    if (state.socket) state.socket.close();
    publishStatus();
    resolveStopped();
  })();

  return stop;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function offsetHoursForZone(zone: string | null | undefined): number {
  const id = resolveDisplayTimezone(zone);
  return TZ_OFFSET_HOURS[id];
}
