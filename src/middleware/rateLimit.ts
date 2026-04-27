import type { NextFunction, Request, Response } from 'express';

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

function getIp(req: Request) {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? req.ip;
  return req.ip;
}

export function createRateLimit(options: { windowMs: number; max: number; keyPrefix?: string }) {
  const { windowMs, max, keyPrefix = 'global' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${keyPrefix}:${getIp(req)}`;
    const current = buckets.get(key);

    if (!current || now - current.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      return next();
    }

    current.count += 1;
    if (current.count <= max) return next();

    const retryAfterMs = Math.max(0, windowMs - (now - current.windowStart));
    res.setHeader('retry-after', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  };
}

