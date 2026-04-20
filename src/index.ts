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
const WEB_ORIGINS = (process.env.WEB_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const WEB_ORIGIN_REGEX = process.env.WEB_ORIGIN_REGEX;

if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI in environment');
}
const MONGODB_URI_REQUIRED: string = MONGODB_URI;
const ALLOWED_ORIGINS = new Set(WEB_ORIGINS.length > 0 ? WEB_ORIGINS : [WEB_ORIGIN]);
const ALLOWED_ORIGIN_REGEX = WEB_ORIGIN_REGEX ? new RegExp(WEB_ORIGIN_REGEX) : null;

async function main() {
  await mongoose.connect(MONGODB_URI_REQUIRED);

  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (curl/Postman/server-to-server) with no Origin header.
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.has(origin)) {
          return callback(null, true);
        }

        if (ALLOWED_ORIGIN_REGEX?.test(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/auth', authRouter);
  app.use('/me', meRouter);
  app.use('/event-types', eventTypesRouter);
  app.use('/public', publicRouter);

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

