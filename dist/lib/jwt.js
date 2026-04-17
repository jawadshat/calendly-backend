"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET)
    throw new Error('Missing JWT_SECRET');
const JWT_SECRET_REQUIRED = JWT_SECRET;
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET_REQUIRED, { expiresIn: '7d' });
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET_REQUIRED);
}
