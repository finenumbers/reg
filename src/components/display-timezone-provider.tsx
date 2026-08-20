"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_DISPLAY_TIMEZONE,
  resolveDisplayTimezone,
  type DisplayTimezoneId,
} from "@/lib/display-timezone";

type DisplayTimezoneContextValue = {
  timeZone: DisplayTimezoneId;
  setTimeZone: (timeZone: string) => void;
};

const DisplayTimezoneContext = createContext<DisplayTimezoneContextValue>({
  timeZone: DEFAULT_DISPLAY_TIMEZONE,
  setTimeZone: () => {},
});

export function DisplayTimezoneProvider({
  initial,
  children,
}: {
  initial: string;
  children: ReactNode;
}) {
  const [timeZone, setTimeZoneState] = useState<DisplayTimezoneId>(() =>
    resolveDisplayTimezone(initial),
  );

  useEffect(() => {
    setTimeZoneState(resolveDisplayTimezone(initial));
  }, [initial]);

  const setTimeZone = useCallback((next: string) => {
    setTimeZoneState(resolveDisplayTimezone(next));
  }, []);

  const value = useMemo(
    () => ({ timeZone, setTimeZone }),
    [timeZone, setTimeZone],
  );

  return (
    <DisplayTimezoneContext.Provider value={value}>
      {children}
    </DisplayTimezoneContext.Provider>
  );
}

export function useDisplayTimezone(): DisplayTimezoneContextValue {
  return useContext(DisplayTimezoneContext);
}
