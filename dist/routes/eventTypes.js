"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventTypesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const EventType_1 = require("../models/EventType");
const errors_1 = require("../middleware/errors");
exports.eventTypesRouter = (0, express_1.Router)();
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
    return res.status(201).json({ item: created });
}));
exports.eventTypesRouter.put('/:id', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
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
    const updated = await EventType_1.EventTypeModel.findOneAndUpdate({ _id: req.params.id, userId }, { $set: updateData }, { new: true }).lean();
    if (!updated)
        return res.status(404).json({ error: 'Not found' });
    return res.json({ item: updated });
}));
exports.eventTypesRouter.delete('/:id', auth_1.requireAuth, (0, errors_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const deleted = await EventType_1.EventTypeModel.findOneAndDelete({ _id: req.params.id, userId }).lean();
    if (!deleted)
        return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true });
}));
