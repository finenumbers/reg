/** A signaling module name as returned by «Активные модули» on this switch. */
const SIGNALING_MODULE = /^signaling-[0-9]+$/;
/** A scripting module name as returned by «Активные модули» on this switch. */
const SCRIPTING_MODULE = /^scripting-[0-9]+$/;

/** Twice the signaling and scripting modules seen on the live switch. */
export const CALL_MODULE_CAP = 4;

export type CallModules =
  | { ok: true; signaling: string[]; scripting: string[] }
  | { ok: false; reason: "none" | "many" | "unexpected" };

function isNumberedCallModule(name: string): boolean {
  return SIGNALING_MODULE.test(name) || SCRIPTING_MODULE.test(name);
}

/** A signaling or scripting name that is not `name-<digits>` would hide calls. */
function isOddCallName(name: string): boolean {
  return /^(signaling|scripting)/i.test(name) && !isNumberedCallModule(name);
}

/**
 * Keep the numbered signaling and scripting modules.
 * Names are returned unchanged, so the SOAP header matches the switch.
 * A fifth module of either kind is an error, not a shorter list.
 */
export function selectCallModules(names: readonly string[]): CallModules {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const text = name.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  if (unique.some((name) => isOddCallName(name))) {
    return { ok: false, reason: "unexpected" };
  }
  const signaling = unique.filter((name) => SIGNALING_MODULE.test(name)).sort();
  const scripting = unique.filter((name) => SCRIPTING_MODULE.test(name)).sort();
  if (signaling.length > CALL_MODULE_CAP || scripting.length > CALL_MODULE_CAP) {
    return { ok: false, reason: "many" };
  }
  if (signaling.length === 0 || scripting.length === 0) {
    return { ok: false, reason: "none" };
  }
  return { ok: true, signaling, scripting };
}
