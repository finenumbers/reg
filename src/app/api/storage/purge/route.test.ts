import { describe, expect, it } from "vitest";
import { purgeConflictMessage } from "@/app/api/storage/purge/route";

describe("purgeConflictMessage", () => {
  it("names database compression when vacuum is in flight", () => {
    expect(purgeConflictMessage("anti-overlap: db.vacuum in flight")).toBe(
      "Дождитесь окончания сжатия базы",
    );
  });

  it("keeps the import and generic messages", () => {
    expect(purgeConflictMessage("anti-overlap: cdr.import in flight")).toBe(
      "Дождитесь окончания импорта CDR",
    );
    expect(purgeConflictMessage("anti-overlap: smg.import in flight")).toBe(
      "Дождитесь окончания импорта SMG",
    );
    expect(purgeConflictMessage("anti-overlap: cdr.purge.month in flight")).toBe(
      "Удаление уже выполняется",
    );
  });
});
