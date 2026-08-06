/**
 * Path / argv validation for remote actions.
 * Defense-in-depth even when paths are code constants.
 */

import {
  assertOptScriptsPath,
  resolveActionForExecution,
  type AllowedActionDefinition,
} from "@/modules/actions/registry";

export type ValidatedRemoteAction = AllowedActionDefinition;

export function validateActionCode(actionCode: string): ValidatedRemoteAction {
  const action = resolveActionForExecution(actionCode);
  assertOptScriptsPath(action.remotePath);
  return action;
}

/**
 * Reject any attempt to smuggle shell metacharacters into a "path".
 */
export function rejectUnsafeRemoteInput(input: {
  command?: unknown;
  scriptPath?: unknown;
  remoteArgs?: unknown;
}): void {
  if (
    input.command !== undefined ||
    input.scriptPath !== undefined ||
    input.remoteArgs !== undefined
  ) {
    throw new Error(
      "Rejected: clients must not send command, scriptPath, or remoteArgs",
    );
  }
}
