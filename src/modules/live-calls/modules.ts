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

export type RegistrationModuleNeed = {
  signaling: boolean;
  scripting: boolean;
};

/**
 * The same module names as the call snapshot, but only the sides whose
 * registration page is the shared template. A summary page does not ask
 * for its side. Other module names stay unread.
 */
export function selectRegistrationModules(
  names: readonly string[],
  need: RegistrationModuleNeed,
): { ok: true; signaling: string[]; scripting: string[] } | { ok: false; detail: string } {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const text = name.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  const signaling = unique.filter((name) => SIGNALING_MODULE.test(name)).sort();
  const scripting = unique.filter((name) => SCRIPTING_MODULE.test(name)).sort();
  if (need.signaling && unique.some((name) => isOddFamily(name, "signaling"))) {
    return { ok: false, detail: "Модуль signaling или scripting назван не по шаблону." };
  }
  if (need.scripting && unique.some((name) => isOddFamily(name, "scripting"))) {
    return { ok: false, detail: "Модуль signaling или scripting назван не по шаблону." };
  }
  if (
    (need.signaling && signaling.length > CALL_MODULE_CAP) ||
    (need.scripting && scripting.length > CALL_MODULE_CAP)
  ) {
    return { ok: false, detail: "Активных модулей signaling или scripting больше четырёх." };
  }
  if (need.signaling && signaling.length === 0) {
    return { ok: false, detail: "Среди активных модулей нет signaling." };
  }
  if (need.scripting && scripting.length === 0) {
    return { ok: false, detail: "Среди активных модулей нет scripting." };
  }
  return {
    ok: true,
    signaling: need.signaling ? signaling : [],
    scripting: need.scripting ? scripting : [],
  };
}

function isOddFamily(name: string, family: "signaling" | "scripting"): boolean {
  const prefix = family === "signaling" ? /^signaling/i : /^scripting/i;
  const exact = family === "signaling" ? SIGNALING_MODULE : SCRIPTING_MODULE;
  return prefix.test(name) && !exact.test(name);
}
