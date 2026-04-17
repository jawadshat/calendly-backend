"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jwt_1 = require("../lib/jwt");
const User_1 = require("../models/User");
async function requireAuth(req, res, next) {
    try {
        const header = req.header('authorization');
        if (!header?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }
        const token = header.slice('Bearer '.length);
        const payload = (0, jwt_1.verifyAccessToken)(token);
        const user = await User_1.UserModel.findById(payload.sub).select('_id').lean();
        if (!user)
            return res.status(401).json({ error: 'Invalid token' });
        req.userId = String(user._id);
        return next();
    }
    catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}
