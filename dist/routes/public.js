"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const luxon_1 = require("luxon");
const User_1 = require("../models/User");
const EventType_1 = require("../models/EventType");
const Availability_1 = require("../models/Availability");
const Booking_1 = require("../models/Booking");
const slots_1 = require("../lib/slots");
const mailer_1 = require("../lib/mailer");
const jwt_1 = require("../lib/jwt");
const googleCalendar_1 = require("../lib/googleCalendar");
exports.publicRouter = (0, express_1.Router)();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
exports.publicRouter.get('/users/:username/event-types', async (req, res) => {
    const user = await User_1.UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
        .select('_id username displayName timezone')
        .lean();
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const items = await EventType_1.EventTypeModel.find({ userId: user._id, isActive: true })
        .select('slug title description durationMinutes locationType')
        .lean();
    return res.json({ user, items });
});
exports.publicRouter.get('/users/:username/event-types/:slug/slots', async (req, res) => {
    const schema = zod_1.z.object({
        startUtcISO: zod_1.z.string().datetime({ offset: true }),
        endUtcISO: zod_1.z.string().datetime({ offset: true }),
    }).superRefine((val, ctx) => {
        const start = luxon_1.DateTime.fromISO(val.startUtcISO, { zone: 'utc' });
        const end = luxon_1.DateTime.fromISO(val.endUtcISO, { zone: 'utc' });
        if (!start.isValid || !end.isValid) {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'Invalid datetime range' });
            return;
        }
        if (end <= start) {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'endUtcISO must be greater than startUtcISO' });
            return;
        }
        const maxWindowDays = 120;
        if (end.diff(start, 'days').days > maxWindowDays) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `Date range too large (max ${maxWindowDays} days)`,
            });
        }
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const user = await User_1.UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
        .select('_id username displayName timezone')
        .lean();
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const eventType = await EventType_1.EventTypeModel.findOne({
        userId: user._id,
        slug: new RegExp(`^${esc(req.params.slug)}$`, 'i'),
        isActive: true,
    }).lean();
    if (!eventType)
        return res.status(404).json({ error: 'Event type not found' });
    const availability = (await Availability_1.AvailabilityModel.findOne({ userId: user._id, eventTypeId: eventType._id }).lean()) ??
        (await Availability_1.AvailabilityModel.findOne({ userId: user._id, eventTypeId: { $exists: false } }).lean());
    if (!availability)
        return res.json({ slots: [] });
    const maxEnd = luxon_1.DateTime.utc().plus({ days: availability.maxDaysInFuture }).toISO();
    const endUtcISO = luxon_1.DateTime.fromISO(parsed.data.endUtcISO, { zone: 'utc' }).toISO();
    const clampedEnd = luxon_1.DateTime.fromISO(endUtcISO, { zone: 'utc' }) > luxon_1.DateTime.fromISO(maxEnd, { zone: 'utc' }) ? maxEnd : endUtcISO;
    const allSlots = (0, slots_1.generateWeeklySlots)({
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
    const bookings = await Booking_1.BookingModel.find({
        userId: user._id,
        status: 'confirmed',
        startUtc: { $lt: rangeEnd },
        endUtc: { $gt: rangeStart },
    })
        .select('startUtc endUtc')
        .lean();
    const slots = allSlots.filter((s) => {
        const slotStart = luxon_1.DateTime.fromISO(s.startUtcISO, { zone: 'utc' });
        const slotEnd = luxon_1.DateTime.fromISO(s.endUtcISO, { zone: 'utc' });
        return !bookings.some((b) => {
            const bookingStart = luxon_1.DateTime.fromJSDate(new Date(b.startUtc), { zone: 'utc' });
            const bookingEnd = luxon_1.DateTime.fromJSDate(new Date(b.endUtc), { zone: 'utc' });
            return slotStart < bookingEnd && bookingStart < slotEnd;
        });
    });
    let finalSlots = slots;
    if ((0, googleCalendar_1.isGoogleCalendarConfigured)()) {
        const hostWithGoogle = await User_1.UserModel.findById(user._id)
            .select('googleCalendar')
            .lean();
        const googleCreds = hostWithGoogle?.googleCalendar;
        if (googleCreds?.refreshToken) {
            try {
                const busyRanges = await (0, googleCalendar_1.getGoogleBusyRanges)({
                    accessToken: googleCreds.accessToken,
                    refreshToken: googleCreds.refreshToken,
                    expiryDate: googleCreds.expiryDate,
                    timeMin: parsed.data.startUtcISO,
                    timeMax: clampedEnd,
                });
                finalSlots = slots.filter((s) => {
                    const slotStart = luxon_1.DateTime.fromISO(s.startUtcISO, { zone: 'utc' });
                    const slotEnd = luxon_1.DateTime.fromISO(s.endUtcISO, { zone: 'utc' });
                    return !busyRanges.some((busy) => {
                        const busyStart = luxon_1.DateTime.fromISO(busy.start, { zone: 'utc' });
                        const busyEnd = luxon_1.DateTime.fromISO(busy.end, { zone: 'utc' });
                        return slotStart < busyEnd && busyStart < slotEnd;
                    });
                });
            }
            catch (err) {
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
exports.publicRouter.post('/users/:username/event-types/:slug/book', async (req, res) => {
    const schema = zod_1.z.object({
        inviteeName: zod_1.z.string().min(2).max(120),
        inviteeEmail: zod_1.z.string().email(),
        startUtcISO: zod_1.z.string().datetime({ offset: true }),
        endUtcISO: zod_1.z.string().datetime({ offset: true }),
        inviteeTimezone: zod_1.z.string().min(1).default('UTC'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const user = await User_1.UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
        .select('_id username displayName timezone email')
        .lean();
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    // Public link should be open for everyone, but host cannot book their own event.
    const authHeader = req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        try {
            const token = authHeader.slice('Bearer '.length);
            const payload = (0, jwt_1.verifyAccessToken)(token);
            if (payload.sub === String(user._id)) {
                return res.status(403).json({ error: 'You cannot book your own meetings slot' });
            }
        }
        catch {
            // Ignore invalid token and continue as public booking flow.
        }
    }
    const eventType = await EventType_1.EventTypeModel.findOne({
        userId: user._id,
        slug: new RegExp(`^${esc(req.params.slug)}$`, 'i'),
        isActive: true,
    }).lean();
    if (!eventType)
        return res.status(404).json({ error: 'Event type not found' });
    const availability = (await Availability_1.AvailabilityModel.findOne({ userId: user._id, eventTypeId: eventType._id }).lean()) ??
        (await Availability_1.AvailabilityModel.findOne({ userId: user._id, eventTypeId: { $exists: false } }).lean());
    if (!availability)
        return res.status(400).json({ error: 'Host has no availability configured' });
    // Validate requested slot is actually available (regenerate slots for that day range)
    const start = luxon_1.DateTime.fromISO(parsed.data.startUtcISO, { zone: 'utc' });
    const end = luxon_1.DateTime.fromISO(parsed.data.endUtcISO, { zone: 'utc' });
    if (!start.isValid || !end.isValid || end <= start)
        return res.status(400).json({ error: 'Invalid time range' });
    if (end.diff(start, 'minutes').minutes !== eventType.durationMinutes) {
        return res.status(400).json({ error: 'Duration mismatch' });
    }
    const dayStart = start.startOf('day').toISO();
    const dayEnd = start.endOf('day').toISO();
    const slots = (0, slots_1.generateWeeklySlots)({
        hostTimezone: availability.timezone,
        weekly: availability.weekly,
        durationMinutes: eventType.durationMinutes,
        rangeStartUtcISO: dayStart,
        rangeEndUtcISO: dayEnd,
        minNoticeMinutes: availability.minNoticeMinutes,
        bufferBeforeMinutes: availability.bufferBeforeMinutes,
        bufferAfterMinutes: availability.bufferAfterMinutes,
    });
    const wantedKey = `${start.toISO()}_${end.toISO()}`;
    const ok = slots.some((s) => `${s.startUtcISO}_${s.endUtcISO}` === wantedKey);
    if (!ok)
        return res.status(409).json({ error: 'Slot not available' });
    const overlappingBooking = await Booking_1.BookingModel.findOne({
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
        const hostWithGoogle = await User_1.UserModel.findById(user._id)
            .select('googleCalendar')
            .lean();
        const booking = await Booking_1.BookingModel.create({
            userId: user._id,
            eventTypeId: eventType._id,
            inviteeName: parsed.data.inviteeName,
            inviteeEmail: parsed.data.inviteeEmail,
            startUtc: new Date(parsed.data.startUtcISO),
            endUtc: new Date(parsed.data.endUtcISO),
            timezone: parsed.data.inviteeTimezone,
            status: 'confirmed',
        });
        const googleCreds = hostWithGoogle?.googleCalendar;
        if ((0, googleCalendar_1.isGoogleCalendarConfigured)() && googleCreds?.refreshToken) {
            try {
                await (0, googleCalendar_1.createGoogleCalendarEvent)({
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
            }
            catch (googleErr) {
                // eslint-disable-next-line no-console
                console.error('Google Calendar event creation failed:', googleErr);
            }
        }
        // Best-effort email notifications to host + invitee.
        try {
            await (0, mailer_1.sendBookingEmails)({
                hostName: user.displayName,
                hostEmail: user.email ?? '',
                inviteeName: parsed.data.inviteeName,
                inviteeEmail: parsed.data.inviteeEmail,
                eventTitle: eventType.title,
                startUtcISO: new Date(booking.startUtc).toISOString(),
                endUtcISO: new Date(booking.endUtc).toISOString(),
                hostTimezone: user.timezone,
                inviteeTimezone: parsed.data.inviteeTimezone,
            });
        }
        catch (emailErr) {
            // Keep booking successful, but make delivery problems visible in server logs.
            // eslint-disable-next-line no-console
            console.error('Booking email delivery failed:', emailErr);
        }
        return res.status(201).json({
            booking: {
                id: String(booking._id),
                host: { username: user.username, displayName: user.displayName },
                eventType: { slug: eventType.slug, title: eventType.title, durationMinutes: eventType.durationMinutes },
                startUtcISO: new Date(booking.startUtc).toISOString(),
                endUtcISO: new Date(booking.endUtc).toISOString(),
                inviteeName: booking.inviteeName,
                inviteeEmail: booking.inviteeEmail,
            },
        });
    }
    catch {
        return res.status(409).json({ error: 'This time was just booked. Pick another slot.' });
    }
});
