import { NextResponse } from "next/server";
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";

/** 409 before a CDR read, or null when vacuum is idle. */
export function cdrVacuumBusyResponse(): NextResponse | null {
  if (!isDatabaseVacuumActive()) return null;
  return NextResponse.json(
    { error: CDR_VACUUM_BUSY_MESSAGE, code: "CONFLICT" },
    { status: 409 },
  );
}
