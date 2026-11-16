"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ChainSourceId, ChainView } from "@/modules/numbering-chain/order";
import type { SyncScreen } from "@/modules/numbering-chain/screen";
import {
  emptyParsed,
  parsedShown,
  type ProviderKey,
} from "@/modules/numbering-sync/card-numbers";

const EMPTY: SyncScreen = {
  chain: { running: false, queue: null, banner: null, cards: {} },
  nextRunLabel: "—",
  parsed: emptyParsed(),
};

const ChainContext = createContext<SyncScreen>(EMPTY);

function isScreen(value: unknown): value is SyncScreen {
  if (!value || typeof value !== "object") return false;
  const screen = value as SyncScreen;
  return (
    Boolean(screen.chain) &&
    typeof screen.nextRunLabel === "string" &&
    Boolean(screen.parsed?.providers)
  );
}

export function ChainProvider({
  initial,
  children,
}: {
  initial: SyncScreen;
  children: ReactNode;
}) {
  const [screen, setScreen] = useState(initial);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/numbering-sync/chain");
        const body: unknown = await response.json().catch(() => null);
        if (!stopped && response.ok && isScreen(body)) setScreen(body);
      } catch {
        /* The next poll retries. */
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return <ChainContext.Provider value={screen}>{children}</ChainContext.Provider>;
}

export function useChainView(): ChainView {
  return useContext(ChainContext).chain;
}

export function useChainRunning(): boolean {
  return useChainView().running;
}

export function useNextRunLabel(): string {
  return useContext(ChainContext).nextRunLabel;
}

export function useParsedCount(
  key: ProviderKey,
  free: number | null,
  purchased: number | null,
): number | null {
  return parsedShown(useContext(ChainContext).parsed, key, free, purchased);
}

export function ChainCardNote({ source }: { source: ChainSourceId }) {
  const line = useChainView().cards[source];
  if (!line) return null;
  return <p className="text-sm">{line}</p>;
}
