import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { UserModel } from '../models/User';
import { EventTypeModel } from '../models/EventType';
import { AvailabilityModel } from '../models/Availability';
import { BookingModel } from '../models/Booking';
import { generateWeeklySlots } from '../lib/slots';
import { sendBookingEmails } from '../lib/mailer';
import { verifyAccessToken } from '../lib/jwt';
import { createGoogleCalendarEvent, getGoogleBusyRanges, isGoogleCalendarConfigured } from '../lib/googleCalendar';

export const publicRouter = Router();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

publicRouter.get('/users/:username/event-types', async (req, res) => {
  const user = await UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
    .select('_id username displayName timezone')
    .lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const items = await EventTypeModel.find({ userId: user._id, isActive: true })
    .select('slug title description durationMinutes locationType')
    .lean();
  return res.json({ user, items });
});

publicRouter.get('/users/:username/event-types/:slug/slots', async (req, res) => {
  const schema = z.object({
    startUtcISO: z.string().datetime({ offset: true }),
    endUtcISO: z.string().datetime({ offset: true }),
  }).superRefine((val, ctx) => {
    const start = DateTime.fromISO(val.startUtcISO, { zone: 'utc' });
    const end = DateTime.fromISO(val.endUtcISO, { zone: 'utc' });
    if (!start.isValid || !end.isValid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid datetime range' });
      return;
    }
    if (end <= start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endUtcISO must be greater than startUtcISO' });
      return;
    }
    const maxWindowDays = 120;
    if (end.diff(start, 'days').days > maxWindowDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Date range too large (max ${maxWindowDays} days)`,
      });
    }
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

  const availability =
    (await AvailabilityModel.findOne({ userId: user._id, eventTypeId: (eventType as any)._id }).lean()) ??
    (await AvailabilityModel.findOne({ userId: user._id, eventTypeId: { $exists: false } }).lean());
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
  const rangeStart = new Date(parsed.data.startUtcISO);
  const rangeEnd = new Date(clampedEnd);
  const bookings = await BookingModel.find({
    userId: user._id,
    status: 'confirmed',
    startUtc: { $lt: rangeEnd },
    endUtc: { $gt: rangeStart },
  })
    .select('startUtc endUtc')
    .lean();

  const slots = allSlots.filter((s) => {
    const slotStart = DateTime.fromISO(s.startUtcISO, { zone: 'utc' });
    const slotEnd = DateTime.fromISO(s.endUtcISO, { zone: 'utc' });
    return !bookings.some((b) => {
      const bookingStart = DateTime.fromJSDate(new Date(b.startUtc), { zone: 'utc' });
      const bookingEnd = DateTime.fromJSDate(new Date(b.endUtc), { zone: 'utc' });
      return slotStart < bookingEnd && bookingStart < slotEnd;
    });
  });

  let finalSlots = slots;
  if (isGoogleCalendarConfigured()) {
    const hostWithGoogle = await UserModel.findById(user._id)
      .select('googleCalendar')
      .lean();
    const googleCreds = hostWithGoogle?.googleCalendar;
    if (googleCreds?.refreshToken) {
      try {
        const busyRanges = await getGoogleBusyRanges({
          accessToken: googleCreds.accessToken,
          refreshToken: googleCreds.refreshToken,
          expiryDate: googleCreds.expiryDate,
          timeMin: parsed.data.startUtcISO,
          timeMax: clampedEnd,
        });
        finalSlots = slots.filter((s) => {
          const slotStart = DateTime.fromISO(s.startUtcISO, { zone: 'utc' });
          const slotEnd = DateTime.fromISO(s.endUtcISO, { zone: 'utc' });
          return !busyRanges.some((busy) => {
            const busyStart = DateTime.fromISO(busy.start, { zone: 'utc' });
            const busyEnd = DateTime.fromISO(busy.end, { zone: 'utc' });
            return slotStart < busyEnd && busyStart < slotEnd;
          });
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Google Calendar busy-range check failed:', err);
      }
    }
  }

  return res.json({
    user: { username: user.username, displayName: user.displayName, timezone: user.timezone },
    eventType: {
      slug: eventType.slug,
      title: eventType.title,
      description: eventType.description ?? '',
      durationMinutes: eventType.durationMinutes,
      locationType: eventType.locationType,
    },
    slots: finalSlots,
  });
});

publicRouter.post('/users/:username/event-types/:slug/book', async (req, res) => {
  const schema = z.object({
    inviteeName: z.string().min(2).max(120),
    inviteeEmail: z.string().email(),
    startUtcISO: z.string().datetime({ offset: true }),
    endUtcISO: z.string().datetime({ offset: true }),
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
        return res.status(403).json({ error: 'You cannot book your own meetings slot' });
      }
    } catch {
      // Ignore invalid token and continue as public booking flow.
    }
  }

  const eventType = await EventTypeModel.findOne({
    userId: user._id,
    slug: new RegExp(`^${esc(req.params.slug)}$`, 'i'),
    isActive: true,
  }).lean();
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });

  const availability =
    (await AvailabilityModel.findOne({ userId: user._id, eventTypeId: (eventType as any)._id }).lean()) ??
    (await AvailabilityModel.findOne({ userId: user._id, eventTypeId: { $exists: false } }).lean());
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

  const overlappingBooking = await BookingModel.findOne({
    userId: user._id,
    status: 'confirmed',
    startUtc: { $lt: end.toJSDate() },
    endUtc: { $gt: start.toJSDate() },
  })
    .select('_id')
    .lean();
  if (overlappingBooking) {
    return res.status(409).json({ error: 'This time was just booked. Pick another slot.' });
  }

  try {
    const hostWithGoogle = await UserModel.findById(user._id)
      .select('googleCalendar')
      .lean();

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

    const googleCreds = hostWithGoogle?.googleCalendar;
    if (isGoogleCalendarConfigured() && googleCreds?.refreshToken) {
      try {
        await createGoogleCalendarEvent({
          accessToken: googleCreds.accessToken,
          refreshToken: googleCreds.refreshToken,
          expiryDate: googleCreds.expiryDate,
          summary: eventType.title,
          description: `${parsed.data.inviteeName} booked via ${user.username}/${eventType.slug}`,
          startUtcISO: new Date(booking.startUtc).toISOString(),
          endUtcISO: new Date(booking.endUtc).toISOString(),
          hostTimezone: user.timezone,
          inviteeEmail: parsed.data.inviteeEmail,
          inviteeName: parsed.data.inviteeName,
        });
      } catch (googleErr) {
        // eslint-disable-next-line no-console
        console.error('Google Calendar event creation failed:', googleErr);
      }
    }

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
  } catch {
    return res.status(409).json({ error: 'This time was just booked. Pick another slot.' });
  }
});

