"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { NavClockRow } from "@/lib/nav-clock";

type NavClockContextValue = {
  row: NavClockRow | null;
  setRow: (row: NavClockRow | null) => void;
};

const NavClockContext = createContext<NavClockContextValue>({
  row: null,
  setRow: () => {},
});

export function NavClockProvider({ children }: { children: ReactNode }) {
  const [row, setRowState] = useState<NavClockRow | null>(null);
  const setRow = useCallback((next: NavClockRow | null) => {
    setRowState(next);
  }, []);
  const value = useMemo(() => ({ row, setRow }), [row, setRow]);
  return <NavClockContext.Provider value={value}>{children}</NavClockContext.Provider>;
}

export function useNavClockRow(): NavClockRow | null {
  return useContext(NavClockContext).row;
}

/** Publish before paint. The first server and client render stay uncolored. */
export function usePublishNavClock(row: NavClockRow | null) {
  const { setRow } = useContext(NavClockContext);
  useLayoutEffect(() => {
    setRow(row);
  }, [row, setRow]);
  useLayoutEffect(() => () => setRow(null), [setRow]);
}
