"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const User_1 = require("../models/User");
const Availability_1 = require("../models/Availability");
const zod_1 = require("zod");
const Booking_1 = require("../models/Booking");
const errors_1 = require("../middleware/errors");
const EventType_1 = require("../models/EventType");
const crypto_1 = require("crypto");
const googleCalendar_1 = require("../lib/googleCalendar");
exports.meRouter = (0, express_1.Router)();
exports.meRouter.get('/', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const user = await User_1.UserModel.findById(userId).select('email username displayName timezone googleCalendar').lean();
    const eventTypes = await EventType_1.EventTypeModel.find({ userId }).select('_id').lean();
    const eventTypeIds = eventTypes.map((et) => et._id);
    const availabilities = await Availability_1.AvailabilityModel.find({ userId, eventTypeId: { $in: eventTypeIds } }).lean();
    const legacyAvailability = await Availability_1.AvailabilityModel.findOne({ userId, eventTypeId: { $exists: false } }).lean();
    const availabilityByEventType = Object.fromEntries(availabilities.map((a) => [String(a.eventTypeId), a]));
    return res.json({
        user,
        availability: legacyAvailability,
        availabilityByEventType,
        googleCalendarConnected: Boolean(user?.googleCalendar?.refreshToken),
        googleCalendarEmail: user?.googleCalendar?.email ?? null,
    });
}));
exports.meRouter.put('/availability', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const eventTypeId = typeof req.query.eventTypeId === 'string' ? req.query.eventTypeId : undefined;
    const schema = zod_1.z.object({
        timezone: zod_1.z.string().min(1),
        weekly: zod_1.z
            .array(zod_1.z.object({
            dayOfWeek: zod_1.z.number().int().min(0).max(6),
            startMinute: zod_1.z.number().int().min(0).max(1439),
            endMinute: zod_1.z.number().int().min(1).max(1440),
        }))
            .default([]),
        bufferBeforeMinutes: zod_1.z.number().int().min(0).max(240).default(0),
        bufferAfterMinutes: zod_1.z.number().int().min(0).max(240).default(0),
        minNoticeMinutes: zod_1.z.number().int().min(0).max(10080).default(60),
        maxDaysInFuture: zod_1.z.number().int().min(1).max(365).default(60),
    }).superRefine((val, ctx) => {
        for (const w of val.weekly) {
            if (w.endMinute <= w.startMinute) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    path: ['weekly'],
                    message: `Invalid hours for dayOfWeek=${w.dayOfWeek}: end must be after start`,
                });
            }
        }
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const query = { userId };
    if (eventTypeId) {
        const eventType = await EventType_1.EventTypeModel.findOne({ _id: eventTypeId, userId }).select('_id').lean();
        if (!eventType)
            return res.status(404).json({ error: 'Event type not found' });
        query.eventTypeId = eventType._id;
    }
    else {
        // Backward-compatible user-level availability document.
        query.eventTypeId = { $exists: false };
    }
    const updated = await Availability_1.AvailabilityModel.findOneAndUpdate(query, { $set: { ...parsed.data, ...(eventTypeId ? { eventTypeId } : {}) } }, { new: true, upsert: true }).lean();
    return res.json({ availability: updated });
}));
exports.meRouter.get('/google-calendar/connect-url', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    if (!(0, googleCalendar_1.isGoogleCalendarConfigured)()) {
        return res.status(400).json({ error: 'Google Calendar is not configured on server' });
    }
    const userId = req.userId;
    const state = (0, crypto_1.randomUUID)();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await User_1.UserModel.updateOne({ _id: userId }, { $set: { googleOAuthState: state, googleOAuthStateExpiresAt: expiresAt } });
    const url = (0, googleCalendar_1.buildGoogleConnectUrl)(state);
    return res.json({ url });
}));
exports.meRouter.get('/google-calendar/callback', (0, errors_1.asyncHandler)(async (req, res) => {
    const schema = zod_1.z.object({
        code: zod_1.z.string().min(1),
        state: zod_1.z.string().min(1),
    });
    const parsed = schema.safeParse(req.query);
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    if (!parsed.success) {
        return res.redirect(`${webOrigin}/dashboard/availability?google=error`);
    }
    if (!(0, googleCalendar_1.isGoogleCalendarConfigured)()) {
        return res.redirect(`${webOrigin}/dashboard/availability?google=not-configured`);
    }
    const user = await User_1.UserModel.findOne({
        googleOAuthState: parsed.data.state,
        googleOAuthStateExpiresAt: { $gte: new Date() },
    });
    if (!user) {
        return res.redirect(`${webOrigin}/dashboard/availability?google=invalid-state`);
    }
    const tokens = await (0, googleCalendar_1.exchangeGoogleCode)(parsed.data.code);
    const refreshToken = tokens.refresh_token ?? user.googleCalendar?.refreshToken;
    if (!refreshToken) {
        return res.redirect(`${webOrigin}/dashboard/availability?google=no-refresh-token`);
    }
    const email = await (0, googleCalendar_1.fetchGoogleProfileEmail)({
        accessToken: tokens.access_token,
        refreshToken,
        expiryDate: tokens.expiry_date,
    });
    await User_1.UserModel.updateOne({ _id: user._id }, {
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
    });
    return res.redirect(`${webOrigin}/dashboard/availability?google=connected`);
}));
exports.meRouter.post('/google-calendar/disconnect', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    await User_1.UserModel.updateOne({ _id: userId }, {
        $unset: {
            googleCalendar: '',
            googleOAuthState: '',
            googleOAuthStateExpiresAt: '',
        },
    });
    return res.json({ ok: true });
}));
exports.meRouter.get('/bookings', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const items = await Booking_1.BookingModel.find({ userId, status: 'confirmed' })
        .sort({ startUtc: 1 })
        .limit(200)
        .lean();
    return res.json({ items });
}));
