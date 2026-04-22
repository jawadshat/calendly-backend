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
exports.publicRouter = (0, express_1.Router)();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
exports.publicRouter.get('/users/:username/event-types', async (req, res) => {
    const user = await User_1.UserModel.findOne({ username: new RegExp(`^${esc(req.params.username)}$`, 'i') })
        .select('_id username displayName timezone email')
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
        startUtcISO: zod_1.z.string().min(1),
        endUtcISO: zod_1.z.string().min(1),
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
    const bookings = await Booking_1.BookingModel.find({
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
});
exports.publicRouter.post('/users/:username/event-types/:slug/book', async (req, res) => {
    const schema = zod_1.z.object({
        inviteeName: zod_1.z.string().min(2).max(120),
        inviteeEmail: zod_1.z.string().email(),
        startUtcISO: zod_1.z.string().min(1),
        endUtcISO: zod_1.z.string().min(1),
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
            const err = new Error('Invalid access token');
            return res.status(401).json({ error: err.message });
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
    try {
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
