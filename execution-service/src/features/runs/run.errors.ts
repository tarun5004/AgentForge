// Carry safe public messages without leaking Docker or upstream response details.
export class RunError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

// Cancellation is not confirmed if the worker cannot prove that its container was removed.
export class RunCleanupError extends Error {
  constructor() { super("Container cleanup could not be confirmed; operator review is required."); }
}
