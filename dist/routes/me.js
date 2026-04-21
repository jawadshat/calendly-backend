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
const googleCalendar_1 = require("../lib/googleCalendar");
const jwt_1 = require("../lib/jwt");
exports.meRouter = (0, express_1.Router)();
exports.meRouter.get('/', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const user = await User_1.UserModel.findById(userId).select('email username displayName timezone googleCalendarConnected').lean();
    const availability = await Availability_1.AvailabilityModel.findOne({ userId }).lean();
    return res.json({ user, availability });
}));
exports.meRouter.get('/google-calendar/auth-url', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    if (!(0, googleCalendar_1.isGoogleCalendarConfigured)()) {
        return res.status(400).json({ error: 'Google Calendar is not configured on server' });
    }
    const userId = req.userId;
    const state = (0, jwt_1.signAccessToken)({ sub: userId });
    return res.json({ url: (0, googleCalendar_1.getGoogleOAuthUrl)(state) });
}));
exports.meRouter.get('/google-calendar/callback', (0, errors_1.asyncHandler)(async (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    if (!code || !state)
        return res.status(400).json({ error: 'Missing OAuth code/state' });
    const payload = (0, jwt_1.verifyAccessToken)(state);
    await (0, googleCalendar_1.connectGoogleCalendar)(payload.sub, code);
    const webUrl = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    return res.redirect(`${webUrl}/dashboard/availability?googleCalendar=connected`);
}));
exports.meRouter.put('/availability', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
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
    const updated = await Availability_1.AvailabilityModel.findOneAndUpdate({ userId }, { $set: parsed.data }, { new: true, upsert: true }).lean();
    return res.json({ availability: updated });
}));
exports.meRouter.get('/bookings', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const items = await Booking_1.BookingModel.find({ userId, status: 'confirmed' })
        .sort({ startUtc: 1 })
        .limit(200)
        .lean();
    return res.json({ items });
}));
