export {
  ACTION_REGISTRY,
  getAllowedAction,
  resolveActionForExecution,
  assertOptScriptsPath,
  type AllowedActionCode,
  type AllowedActionDefinition,
} from "@/modules/actions/registry";

export {
  remoteExecutionService,
  SshAllowlistedRemoteExecutionService,
  NotImplementedRemoteExecutionService,
  type RemoteExecutionService,
  type RemoteExecutionRequest,
  type RemoteExecutionResult,
} from "@/modules/actions/execution";

export {
  validateActionCode,
  rejectUnsafeRemoteInput,
} from "@/modules/actions/validation";
