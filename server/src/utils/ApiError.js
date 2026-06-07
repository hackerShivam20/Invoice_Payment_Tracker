// WHY: Node's built-in Error class only has message and stack.
// We need statusCode, isOperational (our error vs a crash),
// and an errors array (for validation errors like "email is required").
// By extending Error, our global error handler can instanceof-check
// and format the response consistently.

class ApiError extends Error {
  constructor(
    statusCode,
    message = "Something went wrong",
    errors = [],       // array of field-level validation errors
    stack = ""
  ) {
    super(message);             // sets this.message via Error
    this.statusCode = statusCode;
    this.data = null;           // always null for errors
    this.success = false;
    this.errors = errors;

    // isOperational = true means WE threw this on purpose.
    // false means it's an unexpected crash (DB down, null pointer, etc.)
    // The error handler uses this to decide what to show the user.
    this.isOperational = true;

    if (stack) {
      this.stack = stack;
    } else {
      // Captures where in code this error was created.
      // Without this, the stack trace points to this constructor, not the caller.
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export { ApiError };