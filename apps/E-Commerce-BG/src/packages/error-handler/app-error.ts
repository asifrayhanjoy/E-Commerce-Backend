// Base Error Class
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  details?: any;

  constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// 404 Not Found Error
export class NotFoundError extends AppError {
  constructor(message = "Resources not found") {
    super(message, 404);
  }
}

// 400 Validation Error
export class ValidationError extends AppError {
  constructor(message = "Invalid request data", details?: any) {
    super(message, 400, true, details);
  }
}

// 401 Authentication Error
export class AuthError extends AppError {
  constructor(message = "Unauthorizes") {
    super(message, 401);
  }
}

// 403 Forbidden Error
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden access") {
    super(message, 403);
  }
}
