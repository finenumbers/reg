import { logger } from "@/lib/logger";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import {
  asRecord,
  domainCardView,
  parseCatalog,
  telnumCardView,
} from "@/modules/vats/card";
import {
  VATS_DOMAIN_LIMIT,
  VATS_SECTION_BUDGET_MS,
  VATS_SOFT_LIMIT,
  VATS_TELNUM_LIMIT,
} from "@/modules/vats/cadence";
import {
  getDialplans,
  getDomain,
  getDomains,
  getGateways,
  getRoutes,
  getTelnum,
  getTelnums,
  parseNameList,
  type BossAuth,
  type BossDeps,
  type BossFailure,
  type BossResult,
} from "@/modules/vats/client";
import { vatsGeneration } from "@/modules/vats/control";
import {
  MSG_BUDGET,
  MSG_DIALPLANS,
  MSG_DOMAIN_LIMIT,
  MSG_EMPTY,
  MSG_GATEWAYS,
  MSG_NOT_LIST,
  MSG_ROUTES,
  MSG_SOFT_MANY,
  MSG_TELNUM_LIMIT,
  MSG_TRUNCATED,
  keptNotice,
  msgSoft,
  parseNamedCatalog,
  resolveRef,
  resolveRefs,
  uniqueInOrder,
  type NamedId,
} from "@/modules/vats/labels";
import { yieldEventLoop, withBossLock } from "@/modules/vats/lock";
import { parseDomainName, parseTelnum } from "@/modules/vats/names";
import {
  emptyDomain,
  emptyTelnum,
  type DomainRow,
  type TelnumRow,
} from "@/modules/vats/rows";

export type SectionOutcome = "published" | "kept" | "skipped";

export type VatsPassResult = {
  called: boolean;
  platformFailure: boolean;
  domains: SectionOutcome;
  telnums: SectionOutcome;
  domainCount: number | null;
  telnumCount: number | null;
  settingsComplete: boolean;
  aborted: boolean;
  error: string | null;
};

export type VatsCycleStore = {
  readDomains(): Promise<DomainRow[]>;
  readTelnums(): Promise<TelnumRow[]>;
  commitDomains(input: {
    rows: DomainRow[];
    notice: string | null;
    cardReadAt: Record<string, string>;
    generation: number;
  }): Promise<SectionOutcome>;
  commitTelnums(input: {
    rows: TelnumRow[];
    notice: string | null;
    generation: number;
  }): Promise<SectionOutcome>;
  setNotice(section: "domains" | "telnums" | "settings", notice: string): Promise<void>;
  saveGateways(rows: NamedId[]): Promise<void>;
  saveRoutes(rows: string[]): Promise<void>;
  saveDialplans(rows: NamedId[]): Promise<void>;
  markCatalogsComplete(generation: number): Promise<boolean>;
};

type Hooks = {
  now: () => number;
  generation: () => number;
  vacuum: () => boolean;
  yield: () => Promise<void>;
  domainLimit: number;
  telnumLimit: number;
  softLimit: number;
  budgetMs: number;
};

const defaultHooks = (): Hooks => ({
  now: () => Date.now(),
  generation: vatsGeneration,
  vacuum: isDatabaseVacuumActive,
  yield: yieldEventLoop,
  domainLimit: VATS_DOMAIN_LIMIT,
  telnumLimit: VATS_TELNUM_LIMIT,
  softLimit: VATS_SOFT_LIMIT,
  budgetMs: VATS_SECTION_BUDGET_MS,
});

function integerOrNull(value: number | null): number | null {
  if (value == null || !Number.isInteger(value)) return null;
  return value;
}

function storedClient(value: string | null): string | null {
  if (value == null) return null;
  if (value.length > 500 || /[\u0000-\u001F\u007F]/.test(value)) return null;
  return value;
}

function transportNotice(failure: BossFailure): string {
  if (failure.truncated) return MSG_TRUNCATED;
  return keptNotice(failure.error);
}

export async function runVatsPass(input: {
  auth: BossAuth;
  deps?: BossDeps;
  store: VatsCycleStore;
  hooks?: Partial<Hooks>;
}): Promise<VatsPassResult> {
  const hooks: Hooks = { ...defaultHooks(), ...input.hooks };
  const generation = hooks.generation();
  const result: VatsPassResult = {
    called: false,
    platformFailure: false,
    domains: "skipped",
    telnums: "skipped",
    domainCount: null,
    telnumCount: null,
    settingsComplete: false,
    aborted: false,
    error: null,
  };
  const catalogNotes: string[] = [];
  let authNotice: string | null = null;
  let stop = false;
  let dialplansOk = false;
  let gatewaysOk = false;
  let routesOk = false;
  let dialplans: NamedId[] = [];
  let gateways: NamedId[] = [];

  function aborted(): boolean {
    return hooks.vacuum() || hooks.generation() !== generation;
  }

  function halt(): void {
    result.aborted = true;
    stop = true;
  }

  function remember(notice: string) {
    result.platformFailure = true;
    if (!result.error) result.error = notice;
  }

  async function read(
    load: () => Promise<BossResult<unknown>>,
  ): Promise<BossResult<unknown> | "abort"> {
    if (aborted()) return "abort";
    result.called = true;
    const response = await withBossLock(load);
    await hooks.yield();
    if (!response.ok && (response.status === 401 || response.status === 403))
      return response;
    if (aborted()) return "abort";
    return response;
  }

  function authOrTransport(failure: BossFailure): "auth" | "transport" {
    if (failure.status === 401 || failure.status === 403) {
      authNotice = failure.error;
      stop = true;
      return "auth";
    }
    return "transport";
  }

  async function failSection(
    section: "domains" | "telnums",
    notice: string,
  ): Promise<void> {
    remember(notice);
    await input.store.setNotice(section, notice);
  }

  async function walkDomains(): Promise<void> {
    const started = hooks.now();
    const list = await read(() => getDomains(input.auth, input.deps));
    if (list === "abort") {
      halt();
      return;
    }
    if (!list.ok) {
      if (authOrTransport(list) === "auth") return;
      await failSection("domains", transportNotice(list));
      return;
    }
    const names = parseNameList(list.data, parseDomainName);
    if (!names) {
      await failSection("domains", keptNotice(MSG_NOT_LIST));
      return;
    }
    const unique = uniqueInOrder(names);
    if (unique.length > hooks.domainLimit) {
      await failSection("domains", MSG_DOMAIN_LIMIT);
      return;
    }
    if (unique.length === 0) {
      const outcome = await input.store.commitDomains({
        rows: [],
        notice: null,
        cardReadAt: {},
        generation,
      });
      result.domains = outcome;
      if (outcome === "published") result.domainCount = 0;
      if (outcome === "kept") await input.store.setNotice("domains", MSG_EMPTY);
      return;
    }
    if (hooks.now() - started >= hooks.budgetMs) {
      await failSection("domains", MSG_BUDGET);
      return;
    }

    const previous = new Map(
      (await input.store.readDomains()).map((row) => [row.name, row]),
    );
    const rows: DomainRow[] = [];
    const cardReadAt: Record<string, string> = {};
    let soft = 0;
    for (const name of unique) {
      if (aborted()) {
        halt();
        return;
      }
      if (hooks.now() - started >= hooks.budgetMs) {
        await failSection("domains", MSG_BUDGET);
        return;
      }
      const readAt = new Date(hooks.now()).toISOString();
      const card = await read(() => getDomain(input.auth, name, input.deps));
      if (card === "abort") {
        halt();
        return;
      }
      if (!card.ok) {
        if (authOrTransport(card) === "auth") return;
        if (card.status === 404) {
          soft += 1;
          rows.push(previous.get(name) ?? emptyDomain(name));
          cardReadAt[name] = readAt;
          if (soft > hooks.softLimit) {
            await failSection("domains", MSG_SOFT_MANY);
            return;
          }
          continue;
        }
        await failSection("domains", transportNotice(card));
        return;
      }
      const raw = asRecord(card.data);
      if (!raw) {
        soft += 1;
        rows.push(previous.get(name) ?? emptyDomain(name));
        cardReadAt[name] = readAt;
        if (soft > hooks.softLimit) {
          await failSection("domains", MSG_SOFT_MANY);
          return;
        }
        continue;
      }
      const view = domainCardView(name, raw);
      const token = typeof raw.dialplan === "string" ? raw.dialplan : null;
      rows.push({
        name,
        client: storedClient(view.client),
        clientAt: null,
        accountsCount: integerOrNull(view.accountsCount),
        accountsLimit: integerOrNull(view.accountsLimit),
        dialplan: token ? resolveRef(token, dialplans) : null,
        frozen: view.frozen,
      });
      cardReadAt[name] = readAt;
    }
    if (stop || aborted()) return;
    const notice = soft > 0 ? msgSoft(soft) : null;
    const outcome = await input.store.commitDomains({
      rows,
      notice,
      cardReadAt,
      generation,
    });
    result.domains = outcome;
    if (outcome === "published") result.domainCount = rows.length;
  }

  async function walkTelnums(catalog: NamedId[]): Promise<void> {
    const started = hooks.now();
    const list = await read(() => getTelnums(input.auth, input.deps));
    if (list === "abort") {
      halt();
      return;
    }
    if (!list.ok) {
      if (authOrTransport(list) === "auth") return;
      await failSection("telnums", transportNotice(list));
      return;
    }
    const names = parseNameList(list.data, parseTelnum);
    if (!names) {
      await failSection("telnums", keptNotice(MSG_NOT_LIST));
      return;
    }
    const unique = uniqueInOrder(names);
    if (unique.length > hooks.telnumLimit) {
      await failSection("telnums", MSG_TELNUM_LIMIT);
      return;
    }
    if (unique.length === 0) {
      const outcome = await input.store.commitTelnums({
        rows: [],
        notice: null,
        generation,
      });
      result.telnums = outcome;
      if (outcome === "published") result.telnumCount = 0;
      if (outcome === "kept") await input.store.setNotice("telnums", MSG_EMPTY);
      return;
    }
    if (hooks.now() - started >= hooks.budgetMs) {
      await failSection("telnums", MSG_BUDGET);
      return;
    }

    const previous = new Map(
      (await input.store.readTelnums()).map((row) => [row.telnum, row]),
    );
    const rows: TelnumRow[] = [];
    let soft = 0;
    for (const telnum of unique) {
      if (aborted()) {
        halt();
        return;
      }
      if (hooks.now() - started >= hooks.budgetMs) {
        await failSection("telnums", MSG_BUDGET);
        return;
      }
      const card = await read(() => getTelnum(input.auth, telnum, input.deps));
      if (card === "abort") {
        halt();
        return;
      }
      if (!card.ok) {
        if (authOrTransport(card) === "auth") return;
        if (card.status === 404) {
          soft += 1;
          rows.push(previous.get(telnum) ?? emptyTelnum(telnum));
          if (soft > hooks.softLimit) {
            await failSection("telnums", MSG_SOFT_MANY);
            return;
          }
          continue;
        }
        await failSection("telnums", transportNotice(card));
        return;
      }
      const raw = asRecord(card.data);
      if (!raw) {
        soft += 1;
        rows.push(previous.get(telnum) ?? emptyTelnum(telnum));
        if (soft > hooks.softLimit) {
          await failSection("telnums", MSG_SOFT_MANY);
          return;
        }
        continue;
      }
      const view = telnumCardView(telnum, raw);
      const domain =
        view.allocatedTo && parseDomainName(view.allocatedTo) === view.allocatedTo
          ? view.allocatedTo
          : null;
      rows.push({
        telnum,
        domain,
        isFmc: view.isFmc,
        gateways: resolveRefs(view.gateways, catalog),
      });
    }
    if (stop || aborted()) return;
    const notice = soft > 0 ? msgSoft(soft) : null;
    const outcome = await input.store.commitTelnums({ rows, notice, generation });
    result.telnums = outcome;
    if (outcome === "published") result.telnumCount = rows.length;
  }

  try {
    const dial = await read(() => getDialplans(input.auth, input.deps));
    if (dial === "abort") halt();
    else if (!dial.ok) {
      if (authOrTransport(dial) === "transport") {
        catalogNotes.push(MSG_DIALPLANS);
        await failSection("domains", MSG_DIALPLANS);
      }
    } else {
      const parsed = parseNamedCatalog(dial.data);
      if (!parsed) {
        catalogNotes.push(MSG_DIALPLANS);
        await failSection("domains", MSG_DIALPLANS);
      } else {
        dialplans = parsed;
        dialplansOk = true;
        await input.store.saveDialplans(parsed);
        await walkDomains();
      }
    }

    if (!stop) {
      const gatewayRead = await read(() => getGateways(input.auth, input.deps));
      if (gatewayRead === "abort") halt();
      else if (!gatewayRead.ok) {
        if (authOrTransport(gatewayRead) === "transport") {
          catalogNotes.push(MSG_GATEWAYS);
          await failSection("telnums", MSG_GATEWAYS);
        }
      } else {
        const parsed = parseNamedCatalog(gatewayRead.data);
        if (!parsed) {
          catalogNotes.push(MSG_GATEWAYS);
          await failSection("telnums", MSG_GATEWAYS);
        } else {
          gateways = parsed;
          gatewaysOk = true;
          await input.store.saveGateways(parsed);
        }
      }
    }

    if (!stop) {
      const routes = await read(() => getRoutes(input.auth, input.deps));
      if (routes === "abort") halt();
      else if (!routes.ok) {
        if (authOrTransport(routes) === "transport") {
          catalogNotes.push(MSG_ROUTES);
          remember(MSG_ROUTES);
        }
      } else {
        const parsed = parseCatalog(routes.data);
        if (!parsed) {
          catalogNotes.push(MSG_ROUTES);
          remember(MSG_ROUTES);
        } else {
          routesOk = true;
          await input.store.saveRoutes(parsed);
        }
      }
    }

    if (!stop && gatewaysOk) await walkTelnums(gateways);
  } catch {
    logger.error("vats.cycle.failed");
    remember("Ошибка загрузки. Снимок не изменён.");
  }

  if (authNotice) {
    const text = keptNotice(authNotice);
    result.platformFailure = true;
    result.error = text;
    result.settingsComplete = false;
    await input.store.setNotice("domains", text);
    await input.store.setNotice("telnums", text);
    await input.store.setNotice("settings", text);
  } else if (catalogNotes.length > 0) {
    result.platformFailure = true;
    if (!result.error) result.error = catalogNotes[0] ?? null;
    await input.store.setNotice("settings", catalogNotes.join(" "));
  } else if (dialplansOk && gatewaysOk && routesOk && !aborted()) {
    result.settingsComplete = await input.store.markCatalogsComplete(generation);
  }

  logger.info("vats.cycle.section", {
    domains: result.domains,
    telnums: result.telnums,
    called: result.called,
    failed: result.platformFailure,
  });
  return result;
}
