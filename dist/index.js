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
const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
if (!MONGODB_URI) {
    throw new Error('Missing MONGODB_URI in environment');
}
const MONGODB_URI_REQUIRED = MONGODB_URI;
async function main() {
    await mongoose_1.default.connect(MONGODB_URI_REQUIRED);
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({
        origin: WEB_ORIGIN,
        credentials: true,
    }));
    app.use(express_1.default.json());
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use('/auth', auth_1.authRouter);
    app.use('/me', me_1.meRouter);
    app.use('/event-types', eventTypes_1.eventTypesRouter);
    app.use('/public', public_1.publicRouter);
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
