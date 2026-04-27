"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventTypesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const EventType_1 = require("../models/EventType");
const errors_1 = require("../middleware/errors");
const Availability_1 = require("../models/Availability");
const User_1 = require("../models/User");
exports.eventTypesRouter = (0, express_1.Router)();
const isDuplicateKeyError = (err) => err?.code === 11000;
const objectIdSchema = zod_1.z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
exports.eventTypesRouter.get('/', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const items = await EventType_1.EventTypeModel.find({ userId }).sort({ createdAt: -1 }).lean();
    return res.json({ items });
}));
exports.eventTypesRouter.post('/', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const schema = zod_1.z.object({
        slug: zod_1.z.string().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
        title: zod_1.z.string().min(2).max(120),
        description: zod_1.z.string().max(2000).optional(),
        durationMinutes: zod_1.z.number().int().min(5).max(480),
        locationType: zod_1.z.enum(['google_meet', 'zoom', 'phone', 'in_person', 'custom']).default('google_meet'),
        isActive: zod_1.z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const created = await EventType_1.EventTypeModel.create({
        userId,
        ...parsed.data,
        slug: parsed.data.slug.trim().toLowerCase(),
    });
    const legacyAvailability = await Availability_1.AvailabilityModel.findOne({ userId, eventTypeId: { $exists: false } }).lean();
    const user = await User_1.UserModel.findById(userId).select('timezone').lean();
    try {
        await Availability_1.AvailabilityModel.findOneAndUpdate({ userId, eventTypeId: created._id }, {
            $setOnInsert: {
                userId,
                eventTypeId: created._id,
                timezone: legacyAvailability?.timezone ?? user?.timezone ?? 'UTC',
                weekly: legacyAvailability?.weekly ?? [],
                bufferBeforeMinutes: legacyAvailability?.bufferBeforeMinutes ?? 0,
                bufferAfterMinutes: legacyAvailability?.bufferAfterMinutes ?? 0,
                minNoticeMinutes: legacyAvailability?.minNoticeMinutes ?? 60,
                maxDaysInFuture: legacyAvailability?.maxDaysInFuture ?? 60,
            },
        }, { upsert: true, new: true }).lean();
    }
    catch (err) {
        // Older databases may still have a unique index on userId from legacy schema.
        // In that case the event type itself is already created, so avoid returning a false failure.
        if (!isDuplicateKeyError(err))
            throw err;
    }
    return res.status(201).json({ item: created });
}));
exports.eventTypesRouter.put('/:id', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const idParsed = objectIdSchema.safeParse(req.params.id);
    if (!idParsed.success)
        return res.status(400).json({ error: idParsed.error.flatten() });
    const schema = zod_1.z.object({
        slug: zod_1.z.string().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
        title: zod_1.z.string().min(2).max(120).optional(),
        description: zod_1.z.string().max(2000).optional(),
        durationMinutes: zod_1.z.number().int().min(5).max(480).optional(),
        locationType: zod_1.z.enum(['google_meet', 'zoom', 'phone', 'in_person', 'custom']).optional(),
        isActive: zod_1.z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const updateData = {
        ...parsed.data,
        ...(parsed.data.slug ? { slug: parsed.data.slug.trim().toLowerCase() } : {}),
    };
    const updated = await EventType_1.EventTypeModel.findOneAndUpdate({ _id: idParsed.data, userId }, { $set: updateData }, { new: true }).lean();
    if (!updated)
        return res.status(404).json({ error: 'Not found' });
    return res.json({ item: updated });
}));
exports.eventTypesRouter.delete('/:id', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const idParsed = objectIdSchema.safeParse(req.params.id);
    if (!idParsed.success)
        return res.status(400).json({ error: idParsed.error.flatten() });
    const deleted = await EventType_1.EventTypeModel.findOneAndDelete({ _id: idParsed.data, userId }).lean();
    if (!deleted)
        return res.status(404).json({ error: 'Not found' });
    await Availability_1.AvailabilityModel.deleteOne({ userId, eventTypeId: deleted._id });
    return res.json({ ok: true });
}));
exports.eventTypesRouter.get('/:id/availability', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const idParsed = objectIdSchema.safeParse(req.params.id);
    if (!idParsed.success)
        return res.status(400).json({ error: idParsed.error.flatten() });
    const eventType = await EventType_1.EventTypeModel.findOne({ _id: idParsed.data, userId }).select('_id').lean();
    if (!eventType)
        return res.status(404).json({ error: 'Event type not found' });
    const availability = await Availability_1.AvailabilityModel.findOne({ userId, eventTypeId: eventType._id }).lean();
    return res.json({ availability });
}));
exports.eventTypesRouter.put('/:id/availability', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const idParsed = objectIdSchema.safeParse(req.params.id);
    if (!idParsed.success)
        return res.status(400).json({ error: idParsed.error.flatten() });
    const eventType = await EventType_1.EventTypeModel.findOne({ _id: idParsed.data, userId }).select('_id').lean();
    if (!eventType)
        return res.status(404).json({ error: 'Event type not found' });
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
    const availability = await Availability_1.AvailabilityModel.findOneAndUpdate({ userId, eventTypeId: eventType._id }, { $set: { ...parsed.data, eventTypeId: eventType._id } }, { new: true, upsert: true }).lean();
    return res.json({ availability });
}));
