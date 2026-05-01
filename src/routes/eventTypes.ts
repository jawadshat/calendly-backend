/** CRUD routes for a host's private event type configurations. */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { EventTypeModel } from '../models/EventType';
import { asyncHandler } from '../middleware/errors';
import { AvailabilityModel } from '../models/Availability';
import { UserModel } from '../models/User';

export const eventTypesRouter = Router();
const isDuplicateKeyError = (err: any) => err?.code === 11000;
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

eventTypesRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const items = await EventTypeModel.find({ userId }).sort({ createdAt: -1 }).lean();
  return res.json({ items });
}));

eventTypesRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const schema = z.object({
    slug: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    title: z.string().min(2).max(120),
    description: z.string().max(2000).optional(),
    durationMinutes: z.number().int().min(5).max(480),
    locationType: z.enum(['google_meet', 'zoom', 'phone', 'in_person', 'custom']).default('google_meet'),
    isActive: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const created = await EventTypeModel.create({
    userId,
    ...parsed.data,
    slug: parsed.data.slug.trim().toLowerCase(),
  });

  const legacyAvailability = await AvailabilityModel.findOne({ userId, eventTypeId: { $exists: false } }).lean();
  const user = await UserModel.findById(userId).select('timezone').lean();
  try {
    await AvailabilityModel.findOneAndUpdate(
      { userId, eventTypeId: created._id },
      {
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
      },
      { upsert: true, new: true },
    ).lean();
  } catch (err) {
    // Older databases may still have a unique index on userId from legacy schema.
    // In that case the event type itself is already created, so avoid returning a false failure.
    if (!isDuplicateKeyError(err)) throw err;
  }

  return res.status(201).json({ item: created });
}));

eventTypesRouter.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const idParsed = objectIdSchema.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: idParsed.error.flatten() });
  const schema = z.object({
    slug: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    title: z.string().min(2).max(120).optional(),
    description: z.string().max(2000).optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    locationType: z.enum(['google_meet', 'zoom', 'phone', 'in_person', 'custom']).optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updateData = {
    ...parsed.data,
    ...(parsed.data.slug ? { slug: parsed.data.slug.trim().toLowerCase() } : {}),
  };

  const updated = await EventTypeModel.findOneAndUpdate(
    { _id: idParsed.data, userId },
    { $set: updateData },
    { new: true },
  ).lean();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  return res.json({ item: updated });
}));

eventTypesRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const idParsed = objectIdSchema.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: idParsed.error.flatten() });
  const deleted = await EventTypeModel.findOneAndDelete({ _id: idParsed.data, userId }).lean();
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  await AvailabilityModel.deleteOne({ userId, eventTypeId: deleted._id });
  return res.json({ ok: true });
}));

eventTypesRouter.get('/:id/availability', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const idParsed = objectIdSchema.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: idParsed.error.flatten() });
  const eventType = await EventTypeModel.findOne({ _id: idParsed.data, userId }).select('_id').lean();
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });

  const availability = await AvailabilityModel.findOne({ userId, eventTypeId: eventType._id }).lean();
  return res.json({ availability });
}));

eventTypesRouter.put('/:id/availability', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const idParsed = objectIdSchema.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: idParsed.error.flatten() });
  const eventType = await EventTypeModel.findOne({ _id: idParsed.data, userId }).select('_id').lean();
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });

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

  const availability = await AvailabilityModel.findOneAndUpdate(
    { userId, eventTypeId: eventType._id },
    { $set: { ...parsed.data, eventTypeId: eventType._id } },
    { new: true, upsert: true },
  ).lean();

  return res.json({ availability });
}));

