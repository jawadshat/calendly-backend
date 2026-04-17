import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { UserModel } from '../models/User';

export type AuthedRequest = Request & { userId: string };

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const token = header.slice('Bearer '.length);
    const payload = verifyAccessToken(token);

    const user = await UserModel.findById(payload.sub).select('_id').lean();
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    (req as AuthedRequest).userId = String(user._id);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

