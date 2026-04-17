import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { EventTypeModel } from '../models/EventType';

export const eventTypesRouter = Router();

eventTypesRouter.get('/', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const items = await EventTypeModel.find({ userId }).sort({ createdAt: -1 }).lean();
  return res.json({ items });
});

eventTypesRouter.post('/', requireAuth, async (req, res) => {
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
  return res.status(201).json({ item: created });
});

eventTypesRouter.put('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
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
    { _id: req.params.id, userId },
    { $set: updateData },
    { new: true },
  ).lean();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  return res.json({ item: updated });
});

eventTypesRouter.delete('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const deleted = await EventTypeModel.findOneAndDelete({ _id: req.params.id, userId }).lean();
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

