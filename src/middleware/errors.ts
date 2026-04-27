import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;

  expose: boolean;

  constructor(status: number, message: string, expose = true) {
    super(message);
    this.status = status;
    this.expose = expose;
  }
}

export function asyncHandler<TReq extends Request = Request>(
  fn: (req: TReq, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req as TReq, res, next).catch(next);
  };
}

function isDuplicateKeyError(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 11000;
}

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.flatten() });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: err.message });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: `Invalid ${err.path}` });
  }

  if (isDuplicateKeyError(err)) {
    const keys = Object.keys(err.keyPattern ?? {});
    const suffix = keys.length > 0 ? `: ${keys.join(', ')}` : '';
    return res.status(409).json({ error: `Duplicate value${suffix}` });
  }

  // eslint-disable-next-line no-console
  console.error('[API ERROR]', err);
  return res.status(500).json({ error: 'Internal server error' });
}
