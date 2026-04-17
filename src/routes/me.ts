import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { AvailabilityModel } from '../models/Availability';
import { z } from 'zod';
import { BookingModel } from '../models/Booking';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const user = await UserModel.findById(userId).select('email username displayName timezone').lean();
  const availability = await AvailabilityModel.findOne({ userId }).lean();
  return res.json({ user, availability });
});

meRouter.put('/availability', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const schema = z.object({
    timezone: z.string().min(1),
    weekly: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          startMinute: z.number().int().min(0).max(1439),
          endMinute: z.number().int().min(1).max(1440),
        }),
      )
      .default([]),
    bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
    bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
    minNoticeMinutes: z.number().int().min(0).max(10080).default(60),
    maxDaysInFuture: z.number().int().min(1).max(365).default(60),
  }).superRefine((val, ctx) => {
    for (const w of val.weekly) {
      if (w.endMinute <= w.startMinute) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weekly'],
          message: `Invalid hours for dayOfWeek=${w.dayOfWeek}: end must be after start`,
        });
      }
    }
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = await AvailabilityModel.findOneAndUpdate(
    { userId },
    { $set: parsed.data },
    { new: true, upsert: true },
  ).lean();

  return res.json({ availability: updated });
});

meRouter.get('/bookings', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const items = await BookingModel.find({ userId, status: 'confirmed' })
    .sort({ startUtc: 1 })
    .limit(200)
    .lean();
  return res.json({ items });
});

