import {
  CALLS_LOG_PATH,
  PARKING_HOST,
  PARKING_USER,
} from "@/modules/antifraud/constants";

declare const parkingHostBrand: unique symbol;
declare const parkingUserBrand: unique symbol;
declare const parkingLogPathBrand: unique symbol;

/** Hostname or address. Only `parseParkingHost` can build this. */
export type ParkingHost = string & { readonly [parkingHostBrand]: never };
/** SSH user. Only `parseParkingUser` can build this. */
export type ParkingUser = string & { readonly [parkingUserBrand]: never };
/** Absolute log path. Only `parseParkingLogPath` can build this. */
export type ParkingLogPath = string & { readonly [parkingLogPathBrand]: never };

export type ParkingTarget = {
  host: ParkingHost;
  username: ParkingUser;
  logPath: ParkingLogPath;
};

export class ParkingTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParkingTargetError";
  }
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isHostname(value: string): boolean {
  if (value.length > 253 || value.endsWith(".")) return false;
  return value
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function isIpv6(value: string): boolean {
  if (!value.includes(":") || value.includes(":::")) return false;
  if (!/^[0-9a-f:]+$/.test(value)) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  if (
    groups.some(
      (group) => group.length < 1 || group.length > 4 || !/^[0-9a-f]+$/.test(group),
    )
  ) {
    return false;
  }
  if (halves.length === 1) return groups.length === 8;
  return groups.length < 8;
}

export function parseParkingHost(raw: string): ParkingHost | null {
  const value = raw.trim().toLowerCase();
  if (!value || value.includes("@") || value.includes("/") || /\s/.test(value))
    return null;
  if (isIpv4(value) || isHostname(value) || isIpv6(value)) return value as ParkingHost;
  return null;
}

export function parseParkingUser(raw: string): ParkingUser | null {
  const value = raw.trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(value)) return null;
  return value as ParkingUser;
}

export function parseParkingLogPath(raw: string): ParkingLogPath | null {
  const value = raw.trim();
  if (
    value.length < 2 ||
    value.length > 200 ||
    !value.startsWith("/") ||
    value.endsWith("/")
  ) {
    return null;
  }
  if (value.includes("//")) return null;
  const segments = value.slice(1).split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    return null;
  }
  return value as ParkingLogPath;
}

function required<T>(value: T | null): T {
  if (value == null) throw new Error("Parking default target is invalid");
  return value;
}

export const DEFAULT_PARKING_TARGET: ParkingTarget = {
  host: required(parseParkingHost(PARKING_HOST)),
  username: required(parseParkingUser(PARKING_USER)),
  logPath: required(parseParkingLogPath(CALLS_LOG_PATH)),
};
