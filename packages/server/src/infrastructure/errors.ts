export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function notFound(message = "This record could not be found."): never {
  throw new AppError(404, "NOT_FOUND", message);
}
export function conflict(
  message = "This record changed. Refresh and try again.",
): never {
  throw new AppError(409, "STALE_REVISION", message);
}
