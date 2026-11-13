/**
 * ABC text shared by the screen and the XLSX.
 * An empty national number keeps the stored ABC.
 */

import { geographyAbcText } from "@/modules/rtu/abc-display";

export function catalogAbcExport(e164: string, abc: string, number: string): string {
  if (!e164) return abc;
  return geographyAbcText(e164, abc, number);
}
