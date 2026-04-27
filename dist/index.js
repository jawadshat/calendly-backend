"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const mongoose_1 = __importDefault(require("mongoose"));
const auth_1 = require("./routes/auth");
const me_1 = require("./routes/me");
const eventTypes_1 = require("./routes/eventTypes");
const public_1 = require("./routes/public");
const errors_1 = require("./middleware/errors");
const rateLimit_1 = require("./middleware/rateLimit");
const Availability_1 = require("./models/Availability");
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
const MONGODB_URI_REQUIRED = MONGODB_URI;
const ALLOWED_ORIGINS = new Set(WEB_ORIGINS.length > 0 ? WEB_ORIGINS : [WEB_ORIGIN]);
const ALLOWED_ORIGIN_REGEX = WEB_ORIGIN_REGEX ? new RegExp(WEB_ORIGIN_REGEX) : null;
async function migrateAvailabilityIndexes() {
    const collection = Availability_1.AvailabilityModel.collection;
    const indexes = await collection.indexes();
    const legacyUniqueUserIdIndexes = indexes.filter((idx) => idx.name !== '_id_' && idx.unique === true && idx.key?.userId === 1);
    for (const idx of legacyUniqueUserIdIndexes) {
        if (!idx.name)
            continue;
        // eslint-disable-next-line no-console
        console.log(`Dropping legacy unique Availability.userId index: ${idx.name}`);
        await collection.dropIndex(idx.name);
    }
    const legacyEventTypeIdIndex = indexes.find((idx) => idx.name === 'eventTypeId_1' && idx.key?.eventTypeId === 1 && !idx.unique);
    if (legacyEventTypeIdIndex?.name) {
        // eslint-disable-next-line no-console
        console.log(`Dropping conflicting Availability index: ${legacyEventTypeIdIndex.name}`);
        await collection.dropIndex(legacyEventTypeIdIndex.name);
    }
    // Ensure current schema indexes exist (including unique partial index on eventTypeId).
    await Availability_1.AvailabilityModel.syncIndexes();
}
async function main() {
    await mongoose_1.default.connect(MONGODB_URI_REQUIRED);
    // eslint-disable-next-line no-console
    console.log('Connected to MongoDB');
    await migrateAvailabilityIndexes();
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({
        origin(origin, callback) {
            // Allow non-browser clients (curl/Postman/server-to-server) with no Origin header.
            if (!origin)
                return callback(null, true);
            if (ALLOWED_ORIGINS.has(origin)) {
                return callback(null, true);
            }
            if (ALLOWED_ORIGIN_REGEX?.test(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`CORS blocked for origin: ${origin}`));
        },
        credentials: true,
    }));
    app.use(express_1.default.json());
    app.get('/', (_req, res) => res.json({ ok: true }));
    const authRateLimit = (0, rateLimit_1.createRateLimit)({ windowMs: 60_000, max: 40, keyPrefix: 'auth' });
    const bookingRateLimit = (0, rateLimit_1.createRateLimit)({ windowMs: 60_000, max: 80, keyPrefix: 'public-book' });
    app.use('/auth', authRateLimit, auth_1.authRouter);
    app.use('/me', me_1.meRouter);
    app.use('/event-types', eventTypes_1.eventTypesRouter);
    app.use('/public/users/:username/event-types/:slug/book', bookingRateLimit);
    app.use('/public', public_1.publicRouter);
    app.use(errors_1.notFoundHandler);
    app.use(errors_1.errorHandler);
    app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`API listening on http://localhost:${PORT}`);
    });
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[BOOT ERROR]', err);
});
process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[UNCAUGHT EXCEPTION]', err);
});
