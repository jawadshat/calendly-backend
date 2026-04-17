"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const User_1 = require("../models/User");
const Availability_1 = require("../models/Availability");
const jwt_1 = require("../lib/jwt");
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/register', async (req, res) => {
    const schema = zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(8),
        username: zod_1.z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
        displayName: zod_1.z.string().min(2).max(80),
        timezone: zod_1.z.string().min(1).default('UTC'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { password, displayName, timezone } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();
    const username = parsed.data.username.trim().toLowerCase();
    const exists = await User_1.UserModel.findOne({ $or: [{ email }, { username }] }).select('_id').lean();
    if (exists)
        return res.status(409).json({ error: 'Email or username already in use' });
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    const user = await User_1.UserModel.create({ email, passwordHash, username, displayName, timezone });
    await Availability_1.AvailabilityModel.create({ userId: user._id, timezone, weekly: [] });
    const token = (0, jwt_1.signAccessToken)({ sub: String(user._id) });
    return res.json({ token });
});
exports.authRouter.post('/login', async (req, res) => {
    const schema = zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const email = parsed.data.email.trim().toLowerCase();
    const { password } = parsed.data;
    const user = await User_1.UserModel.findOne({ email }).lean();
    if (!user)
        return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!ok)
        return res.status(401).json({ error: 'Invalid credentials' });
    const token = (0, jwt_1.signAccessToken)({ sub: String(user._id) });
    return res.json({ token });
});
