import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Missing JWT_SECRET');
const JWT_SECRET_REQUIRED: string = JWT_SECRET;

export type JwtPayload = {
  sub: string; // userId
};

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, JWT_SECRET_REQUIRED, { expiresIn: '7d' });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET_REQUIRED) as JwtPayload;
}

