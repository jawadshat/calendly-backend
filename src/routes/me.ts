/** Authenticated user routes: profile, availability, bookings, Google OAuth. */
import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { AvailabilityModel } from '../models/Availability';
import { z } from 'zod';
import { BookingModel } from '../models/Booking';
import { asyncHandler } from '../middleware/errors';
import { EventTypeModel } from '../models/EventType';
import { randomUUID } from 'crypto';
import {
  buildGoogleConnectUrl,
  exchangeGoogleCode,
  fetchGoogleProfileEmail,
  isGoogleCalendarConfigured,
} from '../lib/googleCalendar';

export const meRouter = Router();

meRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const user = await UserModel.findById(userId).select('email username displayName timezone googleCalendar').lean();
  const eventTypes = await EventTypeModel.find({ userId }).select('_id').lean();
  const eventTypeIds = eventTypes.map((et) => et._id);
  const availabilities = await AvailabilityModel.find({ userId, eventTypeId: { $in: eventTypeIds } }).lean();
  const legacyAvailability = await AvailabilityModel.findOne({ userId, eventTypeId: { $exists: false } }).lean();

  const availabilityByEventType = Object.fromEntries(
    availabilities.map((a) => [String(a.eventTypeId), a]),
  );

  return res.json({
    user,
    availability: legacyAvailability,
    availabilityByEventType,
    googleCalendarConnected: Boolean(user?.googleCalendar?.refreshToken),
    googleCalendarEmail: user?.googleCalendar?.email ?? null,
  });
}));  

meRouter.put('/availability', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const eventTypeId = typeof req.query.eventTypeId === 'string' ? req.query.eventTypeId : undefined;
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

  const query: Record<string, any> = { userId };
  if (eventTypeId) {
    const eventType = await EventTypeModel.findOne({ _id: eventTypeId, userId }).select('_id').lean();
    if (!eventType) return res.status(404).json({ error: 'Event type not found' });
    query.eventTypeId = eventType._id;
  } else {
    // Backward-compatible user-level availability document.
    query.eventTypeId = { $exists: false };
  }

  const updated = await AvailabilityModel.findOneAndUpdate(
    query,
    { $set: { ...parsed.data, ...(eventTypeId ? { eventTypeId } : {}) } },
    { new: true, upsert: true },
  ).lean();

  return res.json({ availability: updated });
}));

meRouter.get('/google-calendar/connect-url', requireAuth, asyncHandler(async (req, res) => {
  if (!isGoogleCalendarConfigured()) {
    return res.status(400).json({ error: 'Google Calendar is not configured on server' });
  }
  const userId = (req as AuthedRequest).userId;
  const state = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await UserModel.updateOne(
    { _id: userId },
    { $set: { googleOAuthState: state, googleOAuthStateExpiresAt: expiresAt } },
  );
  const url = buildGoogleConnectUrl(state);
  return res.json({ url });
}));

meRouter.get('/google-calendar/callback', asyncHandler(async (req, res) => {
  const schema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  });
  const parsed = schema.safeParse(req.query);
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  if (!parsed.success) {
    return res.redirect(`${webOrigin}/dashboard/availability?google=error`);
  }

  if (!isGoogleCalendarConfigured()) {
    return res.redirect(`${webOrigin}/dashboard/availability?google=not-configured`);
  }

  const user = await UserModel.findOne({
    googleOAuthState: parsed.data.state,
    googleOAuthStateExpiresAt: { $gte: new Date() },
  });
  if (!user) {
    return res.redirect(`${webOrigin}/dashboard/availability?google=invalid-state`);
  }

  const tokens = await exchangeGoogleCode(parsed.data.code);
  const refreshToken = tokens.refresh_token ?? user.googleCalendar?.refreshToken;
  if (!refreshToken) {
    return res.redirect(`${webOrigin}/dashboard/availability?google=no-refresh-token`);
  }
  const email = await fetchGoogleProfileEmail({
    accessToken: tokens.access_token,
    refreshToken,
    expiryDate: tokens.expiry_date,
  });

  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        googleCalendar: {
          refreshToken,
          accessToken: tokens.access_token ?? user.googleCalendar?.accessToken,
          expiryDate: tokens.expiry_date ?? user.googleCalendar?.expiryDate,
          email: email ?? user.googleCalendar?.email,
        },
      },
      $unset: {
        googleOAuthState: '',
        googleOAuthStateExpiresAt: '',
      },
    },
  );

  return res.redirect(`${webOrigin}/dashboard/availability?google=connected`);
}));

meRouter.post('/google-calendar/disconnect', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  await UserModel.updateOne(
    { _id: userId },
    {
      $unset: {
        googleCalendar: '',
        googleOAuthState: '',
        googleOAuthStateExpiresAt: '',
      },
    },
  );
  return res.json({ ok: true });
}));

meRouter.get('/bookings', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const items = await BookingModel.find({ userId, status: 'confirmed' })
    .sort({ startUtc: 1 })
    .limit(200)
    .lean();
  return res.json({ items });
}));

