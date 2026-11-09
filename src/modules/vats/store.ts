import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { vatsGeneration } from "@/modules/vats/control";
import type { VatsCycleStore } from "@/modules/vats/cycle";
import type { NamedId } from "@/modules/vats/labels";
import { parseVatsOrigin } from "@/modules/vats/origin";
import {
  catalogBody,
  domainBody,
  mergeDomainRows,
  pageRows,
  parseCatalogSnap,
  parseDomainSnap,
  parseTelnumSnap,
  sortDomainRows,
  sortTelnumRows,
  telnumBody,
  visibleReadAt,
  type CatalogSnap,
  type DomainRow,
  type SectionSnap,
  type TelnumRow,
} from "@/modules/vats/rows";

type Kind = "domains" | "telnums" | "catalogs";

type Locked = {
  names: unknown;
  origin: string;
  readAt: Date;
};

const emptyCatalog = (): CatalogSnap => ({
  complete: false,
  notice: null,
  gateways: [],
  routes: [],
  dialplans: [],
});

function asJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function settingsOrigin(db: {
  appSetting: { findUnique: typeof prisma.appSetting.findUnique };
}): Promise<string | null> {
  const row = await db.appSetting.findUnique({
    where: { id: 1 },
    select: { vatsBossBaseUrl: true },
  });
  const origin = row?.vatsBossBaseUrl ? parseVatsOrigin(row.vatsBossBaseUrl) : null;
  if (!origin || origin !== row?.vatsBossBaseUrl) return null;
  return origin;
}

async function lockKind(
  tx: { $queryRaw: typeof prisma.$queryRaw },
  kind: Kind,
): Promise<Locked | null> {
  const rows = await tx.$queryRaw<Locked[]>(
    Prisma.sql`SELECT names, origin, read_at AS "readAt" FROM vats_name_lists WHERE kind = ${kind} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

async function writeKind(
  tx: { vatsNameList: { upsert: typeof prisma.vatsNameList.upsert } },
  kind: Kind,
  origin: string,
  names: Record<string, unknown>,
  readAt: Date,
): Promise<void> {
  await tx.vatsNameList.upsert({
    where: { kind },
    create: { kind, origin, names: asJson(names), readAt },
    update: { origin, names: asJson(names), readAt },
  });
}

export function createPrismaCycleStore(
  origin: string,
  generation: number,
): VatsCycleStore {
  function current(): boolean {
    return vatsGeneration() === generation;
  }

  async function sameHost(): Promise<boolean> {
    return current() && (await settingsOrigin(prisma)) === origin;
  }

  return {
    async readDomains() {
      const row = await prisma.vatsNameList.findUnique({ where: { kind: "domains" } });
      if (!row || row.origin !== origin) return [];
      return parseDomainSnap(row.names).rows;
    },
    async readTelnums() {
      const row = await prisma.vatsNameList.findUnique({ where: { kind: "telnums" } });
      if (!row || row.origin !== origin) return [];
      return parseTelnumSnap(row.names).rows;
    },
    async commitDomains(input) {
      if (!current() || input.generation !== generation) return "skipped";
      return prisma.$transaction(async (tx) => {
        if (!current() || (await settingsOrigin(tx)) !== origin) return "skipped";
        const locked = await lockKind(tx, "domains");
        const previous =
          locked && locked.origin === origin ? parseDomainSnap(locked.names).rows : [];
        if (input.rows.length === 0 && previous.length > 0) return "kept";
        const rows = sortDomainRows(
          mergeDomainRows(previous, input.rows, input.cardReadAt),
        );
        await writeKind(
          tx,
          "domains",
          origin,
          domainBody({ committed: true, notice: input.notice, rows }),
          new Date(),
        );
        return "published";
      });
    },
    async commitTelnums(input) {
      if (!current() || input.generation !== generation) return "skipped";
      return prisma.$transaction(async (tx) => {
        if (!current() || (await settingsOrigin(tx)) !== origin) return "skipped";
        const locked = await lockKind(tx, "telnums");
        const previous =
          locked && locked.origin === origin ? parseTelnumSnap(locked.names).rows : [];
        if (input.rows.length === 0 && previous.length > 0) return "kept";
        await writeKind(
          tx,
          "telnums",
          origin,
          telnumBody({
            committed: true,
            notice: input.notice,
            rows: sortTelnumRows(input.rows),
          }),
          new Date(),
        );
        return "published";
      });
    },
    async setNotice(section, notice) {
      if (!(await sameHost())) return;
      const kind: Kind = section === "settings" ? "catalogs" : section;
      await prisma.$transaction(async (tx) => {
        if (!(await sameHost())) return;
        const locked = await lockKind(tx, kind);
        const same = Boolean(locked && locked.origin === origin);
        const readAt = same && locked ? locked.readAt : new Date();
        if (kind === "catalogs") {
          const snap = same && locked ? parseCatalogSnap(locked.names) : emptyCatalog();
          snap.notice = notice;
          await writeKind(tx, kind, origin, catalogBody(snap), readAt);
          return;
        }
        if (kind === "domains") {
          const snap: SectionSnap<DomainRow> =
            same && locked
              ? parseDomainSnap(locked.names)
              : { committed: false, notice: null, rows: [] };
          snap.notice = notice;
          await writeKind(tx, kind, origin, domainBody(snap), readAt);
          return;
        }
        const snap: SectionSnap<TelnumRow> =
          same && locked
            ? parseTelnumSnap(locked.names)
            : { committed: false, notice: null, rows: [] };
        snap.notice = notice;
        await writeKind(tx, kind, origin, telnumBody(snap), readAt);
      });
    },
    async saveGateways(rows) {
      await saveCatalog(origin, generation, (snap) => {
        snap.gateways = rows;
      });
    },
    async saveRoutes(rows) {
      await saveCatalog(origin, generation, (snap) => {
        snap.routes = rows;
      });
    },
    async saveDialplans(rows) {
      await saveCatalog(origin, generation, (snap) => {
        snap.dialplans = rows;
      });
    },
    async markCatalogsComplete(expected) {
      if (!current() || expected !== generation) return false;
      return prisma.$transaction(async (tx) => {
        if (!current() || (await settingsOrigin(tx)) !== origin) return false;
        const locked = await lockKind(tx, "catalogs");
        const snap =
          locked && locked.origin === origin
            ? parseCatalogSnap(locked.names)
            : emptyCatalog();
        snap.complete = true;
        snap.notice = null;
        await writeKind(tx, "catalogs", origin, catalogBody(snap), new Date());
        return true;
      });
    },
  };
}

async function saveCatalog(
  origin: string,
  generation: number,
  patch: (snap: CatalogSnap) => void,
): Promise<void> {
  if (vatsGeneration() !== generation) return;
  if ((await settingsOrigin(prisma)) !== origin) return;
  await prisma.$transaction(async (tx) => {
    if (vatsGeneration() !== generation || (await settingsOrigin(tx)) !== origin) return;
    const locked = await lockKind(tx, "catalogs");
    const snap =
      locked && locked.origin === origin
        ? parseCatalogSnap(locked.names)
        : emptyCatalog();
    patch(snap);
    const readAt = locked && locked.origin === origin ? locked.readAt : new Date();
    await writeKind(tx, "catalogs", origin, catalogBody(snap), readAt);
  });
}

export async function stampDomainClient(
  origin: string,
  domain: string,
  client: string | null,
): Promise<void> {
  const clientAt = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    if ((await settingsOrigin(tx)) !== origin) return;
    const locked = await lockKind(tx, "domains");
    if (!locked || locked.origin !== origin) return;
    const snap = parseDomainSnap(locked.names);
    const row = snap.rows.find((item) => item.name === domain);
    if (!row) return;
    row.client = client;
    row.clientAt = clientAt;
    await tx.vatsNameList.update({
      where: { kind: "domains" },
      data: { names: asJson(domainBody(snap)) },
    });
  });
}

export type VatsScreen = {
  readAt: string | null;
  notice: string | null;
  loading: boolean;
};

export async function readDomainScreen(origin: string | null): Promise<{
  screen: VatsScreen;
  rows: DomainRow[];
  committed: boolean;
}> {
  return readScreen("domains", origin, parseDomainSnap);
}

export async function readTelnumScreen(origin: string | null): Promise<{
  screen: VatsScreen;
  rows: TelnumRow[];
  committed: boolean;
}> {
  return readScreen("telnums", origin, parseTelnumSnap);
}

async function readScreen<T>(
  kind: "domains" | "telnums",
  origin: string | null,
  parse: (value: unknown) => SectionSnap<T>,
): Promise<{ screen: VatsScreen; rows: T[]; committed: boolean }> {
  if (!origin) {
    return {
      screen: { readAt: null, notice: null, loading: false },
      rows: [],
      committed: false,
    };
  }
  const row = await prisma.vatsNameList.findUnique({ where: { kind } });
  if (!row || row.origin !== origin) {
    return {
      screen: { readAt: null, notice: null, loading: false },
      rows: [],
      committed: false,
    };
  }
  const snap = parse(row.names);
  return {
    screen: {
      readAt: visibleReadAt(snap.committed, row.readAt),
      notice: snap.notice,
      loading: false,
    },
    rows: snap.rows,
    committed: snap.committed,
  };
}

export async function readCatalogScreen(origin: string | null): Promise<{
  screen: VatsScreen;
  snap: CatalogSnap;
}> {
  if (!origin)
    return {
      screen: { readAt: null, notice: null, loading: false },
      snap: emptyCatalog(),
    };
  const row = await prisma.vatsNameList.findUnique({ where: { kind: "catalogs" } });
  if (!row || row.origin !== origin) {
    return {
      screen: { readAt: null, notice: null, loading: false },
      snap: emptyCatalog(),
    };
  }
  const snap = parseCatalogSnap(row.names);
  return {
    screen: {
      readAt: visibleReadAt(snap.complete, row.readAt),
      notice: snap.notice,
      loading: false,
    },
    snap,
  };
}

export function domainPage(rows: DomainRow[], offset: number, size: number): DomainRow[] {
  return pageRows(sortDomainRows(rows), offset, size);
}

export function telnumPage(rows: TelnumRow[], offset: number, size: number): TelnumRow[] {
  return pageRows(sortTelnumRows(rows), offset, size);
}

export async function readGatewayCatalog(origin: string): Promise<NamedId[]> {
  const row = await prisma.vatsNameList.findUnique({ where: { kind: "catalogs" } });
  if (!row || row.origin !== origin) return [];
  return parseCatalogSnap(row.names).gateways;
}

export async function domainMember(origin: string, name: string): Promise<boolean> {
  const row = await prisma.vatsNameList.findUnique({ where: { kind: "domains" } });
  if (!row || row.origin !== origin) return false;
  return parseDomainSnap(row.names).rows.some((item) => item.name === name);
}

export async function telnumMember(origin: string, telnum: string): Promise<boolean> {
  const row = await prisma.vatsNameList.findUnique({ where: { kind: "telnums" } });
  if (!row || row.origin !== origin) return false;
  return parseTelnumSnap(row.names).rows.some((item) => item.telnum === telnum);
}
