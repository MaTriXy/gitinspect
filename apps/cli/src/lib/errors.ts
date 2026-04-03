export class LoginCancelledError extends Error {
  constructor() {
    super("Login cancelled");
    this.name = "LoginCancelledError";
  }
}

export function isLoginCancelledError(error: Error): boolean {
  return error instanceof LoginCancelledError || error.message === "Login cancelled";
}
