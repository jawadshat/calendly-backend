"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const User_1 = require("../models/User");
const Availability_1 = require("../models/Availability");
const zod_1 = require("zod");
const Booking_1 = require("../models/Booking");
exports.meRouter = (0, express_1.Router)();
exports.meRouter.get('/', auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const user = await User_1.UserModel.findById(userId).select('email username displayName timezone').lean();
    const availability = await Availability_1.AvailabilityModel.findOne({ userId }).lean();
    return res.json({ user, availability });
});
exports.meRouter.put('/availability', auth_1.requireAuth, async (req, res) => {
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
});
exports.meRouter.get('/bookings', auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const items = await Booking_1.BookingModel.find({ userId, status: 'confirmed' })
        .sort({ startUtc: 1 })
        .limit(200)
        .lean();
    return res.json({ items });
});
