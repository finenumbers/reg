/**
 * Username login needs emailAndPassword enabled, which also mounts this route.
 * The form never calls it. Reject it before the password is checked.
 */
export function rejectsEmailSignIn(path: string): boolean {
  return path === "/sign-in/email";
}
