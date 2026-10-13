import { mkdirSync } from "node:fs";
import path from "node:path";
import { cdrInboxRoot } from "@/modules/traffic/paths";

export const SMG_POISON_FILENAME = ".poison.json";

/** SMG CDR lands in a subdirectory of the softswitch FTP inbox. */
export function smgInboxRoot(cwd?: string): string {
  return path.join(cdrInboxRoot(cwd), "smg");
}

export function ensureSmgInbox(cwd?: string): string {
  const root = smgInboxRoot(cwd);
  mkdirSync(root, { recursive: true });
  return root;
}

export function smgPoisonStorePath(cwd?: string): string {
  return path.join(smgInboxRoot(cwd), SMG_POISON_FILENAME);
}
