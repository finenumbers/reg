/**
 * Safe, operator-facing errors for SSH key import and connection test.
 * Never include key material or passphrases in messages.
 */

export type KeyImportErrorCode =
  | "KEY_TOO_LARGE"
  | "KEY_EMPTY"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_KEY"
  | "WRONG_PASSPHRASE"
  | "PASSPHRASE_REQUIRED"
  | "ENCRYPT_FAILED";

export type SshTestErrorCode =
  | "PROFILE_INCOMPLETE"
  | "NO_PRIVATE_KEY"
  | "DECRYPT_FAILED"
  | "AUTH_ERROR"
  | "TIMEOUT"
  | "CONNECTION_ERROR";

export class KeyImportError extends Error {
  readonly code: KeyImportErrorCode;

  constructor(code: KeyImportErrorCode, message: string) {
    super(message);
    this.name = "KeyImportError";
    this.code = code;
  }
}

export function isKeyImportError(error: unknown): error is KeyImportError {
  return error instanceof KeyImportError;
}

export class SshTestError extends Error {
  readonly code: SshTestErrorCode;

  constructor(code: SshTestErrorCode, message: string) {
    super(message);
    this.name = "SshTestError";
    this.code = code;
  }
}

export function isSshTestError(error: unknown): error is SshTestError {
  return error instanceof SshTestError;
}
