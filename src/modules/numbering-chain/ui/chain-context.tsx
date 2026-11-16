"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ChainSourceId, ChainView } from "@/modules/numbering-chain/order";

const EMPTY: ChainView = { running: false, queue: null, banner: null, cards: {} };

const ChainContext = createContext<ChainView>(EMPTY);

export function ChainProvider({
  initial,
  children,
}: {
  initial: ChainView;
  children: ReactNode;
}) {
  const [view, setView] = useState(initial);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/numbering-sync/chain");
        const body = (await response.json().catch(() => null)) as {
          chain?: ChainView;
        } | null;
        if (!stopped && response.ok && body?.chain) setView(body.chain);
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

  return <ChainContext.Provider value={view}>{children}</ChainContext.Provider>;
}

export function useChainView(): ChainView {
  return useContext(ChainContext);
}

export function useChainRunning(): boolean {
  return useChainView().running;
}

export function ChainCardNote({ source }: { source: ChainSourceId }) {
  const line = useChainView().cards[source];
  if (!line) return null;
  return <p className="text-sm">{line}</p>;
}
