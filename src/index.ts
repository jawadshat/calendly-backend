import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import { authRouter } from './routes/auth';
import { meRouter } from './routes/me';
import { eventTypesRouter } from './routes/eventTypes';
import { publicRouter } from './routes/public';

const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

const app = express();

app.use(
  cors({
    origin: WEB_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());

async function ensureDbConnection() {
  if (!MONGODB_URI) {
    throw new Error('Missing MONGODB_URI in environment');
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(MONGODB_URI);
}

app.use(async (_req, _res, next) => {
  try {
    await ensureDbConnection();
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/me', meRouter);
app.use('/event-types', eventTypesRouter);
app.use('/public', publicRouter);

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

export default app;

