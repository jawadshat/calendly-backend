/** Authentication routes for registering users and issuing JWTs. */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserModel } from '../models/User';
import { AvailabilityModel } from '../models/Availability';
import { signAccessToken } from '../lib/jwt';
import { asyncHandler } from '../middleware/errors';

export const authRouter = Router();

authRouter.post('/register', asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
    displayName: z.string().min(2).max(80),
    timezone: z.string().min(1).default('UTC'),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { password, displayName, timezone } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const username = parsed.data.username.trim().toLowerCase();

  const exists = await UserModel.findOne({ $or: [{ email }, { username }] }).select('_id').lean();
  if (exists) return res.status(409).json({ error: 'Email or username already in use' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await UserModel.create({ email, passwordHash, username, displayName, timezone });
  try {
    await AvailabilityModel.create({ userId: user._id, timezone, weekly: [] });
  } catch (err) {
    await UserModel.deleteOne({ _id: user._id });
    throw err;
  }

  const token = signAccessToken({ sub: String(user._id) });
  return res.json({ token });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;
  const user = await UserModel.findOne({ email }).lean();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signAccessToken({ sub: String((user as any)._id) });
  return res.json({ token });
}));

