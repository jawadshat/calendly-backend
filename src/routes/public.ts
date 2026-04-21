import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { UserModel } from '../models/User';
import { EventTypeModel } from '../models/EventType';
import { AvailabilityModel } from '../models/Availability';
import { BookingModel } from '../models/Booking';
import { generateWeeklySlots } from '../lib/slots';
import { sendBookingEmails } from '../lib/mailer';
import { asyncHandler } from '../middleware/errors';
import { verifyAccessToken } from '../lib/jwt';

export const publicRouter = Router();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

publicRouter.get('/users/:username/event-types', asyncHandler(async (req, res) => {
  const user = await UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
    .select('_id username displayName timezone email')
    .lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const items = await EventTypeModel.find({ userId: user._id, isActive: true })
    .select('slug title description durationMinutes locationType')
    .lean();
  return res.json({ user, items });
}));

publicRouter.get('/users/:username/event-types/:slug/slots', asyncHandler(async (req, res) => {
  const schema = z.object({
    startUtcISO: z.string().min(1),
    endUtcISO: z.string().min(1),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
    .select('_id username displayName timezone')
    .lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const eventType = await EventTypeModel.findOne({
    userId: user._id,
    slug: new RegExp(`^${esc(req.params.slug)}$`, 'i'),
    isActive: true,
  }).lean();
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });

  const availability = await AvailabilityModel.findOne({ userId: user._id }).lean();
  if (!availability) return res.json({ slots: [] });

  const maxEnd = DateTime.utc().plus({ days: availability.maxDaysInFuture }).toISO()!;
  const endUtcISO = DateTime.fromISO(parsed.data.endUtcISO, { zone: 'utc' }).toISO()!;
  const clampedEnd = DateTime.fromISO(endUtcISO, { zone: 'utc' }) > DateTime.fromISO(maxEnd, { zone: 'utc' }) ? maxEnd : endUtcISO;

  const allSlots = generateWeeklySlots({
    hostTimezone: availability.timezone,
    weekly: availability.weekly,
    durationMinutes: eventType.durationMinutes,
    rangeStartUtcISO: parsed.data.startUtcISO,
    rangeEndUtcISO: clampedEnd,
    minNoticeMinutes: availability.minNoticeMinutes,
    bufferBeforeMinutes: availability.bufferBeforeMinutes,
    bufferAfterMinutes: availability.bufferAfterMinutes,
  });

  // remove already booked slots (simple exact-match filtering)
  const bookings = await BookingModel.find({
    userId: user._id,
    status: 'confirmed',
    startUtc: { $gte: new Date(parsed.data.startUtcISO), $lte: new Date(clampedEnd) },
  })
    .select('startUtc endUtc')
    .lean();
  const booked = new Set(bookings.map((b) => `${new Date(b.startUtc).toISOString()}_${new Date(b.endUtc).toISOString()}`));

  const slots = allSlots.filter((s) => !booked.has(`${new Date(s.startUtcISO).toISOString()}_${new Date(s.endUtcISO).toISOString()}`));

  return res.json({
    user: { username: user.username, displayName: user.displayName, timezone: user.timezone },
    eventType: {
      slug: eventType.slug,
      title: eventType.title,
      description: eventType.description ?? '',
      durationMinutes: eventType.durationMinutes,
      locationType: eventType.locationType,
    },
    slots,
  });
}));

publicRouter.post('/users/:username/event-types/:slug/book', asyncHandler(async (req, res) => {
  const schema = z.object({
    inviteeName: z.string().min(2).max(120),
    inviteeEmail: z.string().email(),
    startUtcISO: z.string().min(1),
    endUtcISO: z.string().min(1),
    inviteeTimezone: z.string().min(1).default('UTC'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
    .select('_id username displayName timezone email')
    .lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Public link should be open for everyone, but host cannot book their own event.
  const authHeader = req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice('Bearer '.length);
      const payload = verifyAccessToken(token);
      if (payload.sub === String((user as any)._id)) {
        return res.status(403).json({ error: 'You cannot book your own event link' });
      }
    } catch {
      // Ignore invalid token here so anonymous/public flow still works.
    }
  }

  const eventType = await EventTypeModel.findOne({
    userId: user._id,
    slug: new RegExp(`^${esc(req.params.slug)}$`, 'i'),
    isActive: true,
  }).lean();
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });

  const availability = await AvailabilityModel.findOne({ userId: user._id }).lean();
  if (!availability) return res.status(400).json({ error: 'Host has no availability configured' });

  // Validate requested slot is actually available (regenerate slots for that day range)
  const start = DateTime.fromISO(parsed.data.startUtcISO, { zone: 'utc' });
  const end = DateTime.fromISO(parsed.data.endUtcISO, { zone: 'utc' });
  if (!start.isValid || !end.isValid || end <= start) return res.status(400).json({ error: 'Invalid time range' });
  if (end.diff(start, 'minutes').minutes !== eventType.durationMinutes) {
    return res.status(400).json({ error: 'Duration mismatch' });
  }

  const dayStart = start.startOf('day').toISO()!;
  const dayEnd = start.endOf('day').toISO()!;

  const slots = generateWeeklySlots({
    hostTimezone: availability.timezone,
    weekly: availability.weekly,
    durationMinutes: eventType.durationMinutes,
    rangeStartUtcISO: dayStart,
    rangeEndUtcISO: dayEnd,
    minNoticeMinutes: availability.minNoticeMinutes,
    bufferBeforeMinutes: availability.bufferBeforeMinutes,
    bufferAfterMinutes: availability.bufferAfterMinutes,
  });

  const wantedKey = `${start.toISO()!}_${end.toISO()!}`;
  const ok = slots.some((s) => `${s.startUtcISO}_${s.endUtcISO}` === wantedKey);
  if (!ok) return res.status(409).json({ error: 'Slot not available' });

  try {
    const booking = await BookingModel.create({
      userId: user._id,
      eventTypeId: (eventType as any)._id,
      inviteeName: parsed.data.inviteeName,
      inviteeEmail: parsed.data.inviteeEmail,
      startUtc: new Date(parsed.data.startUtcISO),
      endUtc: new Date(parsed.data.endUtcISO),
      timezone: parsed.data.inviteeTimezone,
      status: 'confirmed',
    });

    // Best-effort email notifications to host + invitee.
    try {
      await sendBookingEmails({
        hostName: user.displayName,
        hostEmail: (user as any).email ?? '',
        inviteeName: parsed.data.inviteeName,
        inviteeEmail: parsed.data.inviteeEmail,
        eventTitle: eventType.title,
        startUtcISO: new Date(booking.startUtc).toISOString(),
        endUtcISO: new Date(booking.endUtc).toISOString(),
        hostTimezone: user.timezone,
        inviteeTimezone: parsed.data.inviteeTimezone,
      });
    } catch (emailErr) {
      // Keep booking successful, but make delivery problems visible in server logs.
      // eslint-disable-next-line no-console
      console.error('Booking email delivery failed:', emailErr);
    }

 

    return res.status(201).json({
      booking: {
        id: String((booking as any)._id),
        host: { username: user.username, displayName: user.displayName },
        eventType: { slug: eventType.slug, title: eventType.title, durationMinutes: eventType.durationMinutes },
        startUtcISO: new Date(booking.startUtc).toISOString(),
        endUtcISO: new Date(booking.endUtc).toISOString(),
        inviteeName: booking.inviteeName,
        inviteeEmail: booking.inviteeEmail,
      },
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'This time was just booked. Pick another slot.' });
    }
    // eslint-disable-next-line no-console
    console.error('Booking create failed:', err);
    return res.status(500).json({ error: 'Could not complete booking. Please try again.' });
  }
}));

