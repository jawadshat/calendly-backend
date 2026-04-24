import mongoose, { Schema } from 'mongoose';

export type UserDoc = {
  email: string;
  passwordHash: string;
  username: string; // public slug
  displayName: string;
  timezone: string; // IANA name, e.g. "America/New_York"
  googleCalendar?: {
    refreshToken?: string;
    accessToken?: string;
    expiryDate?: number;
    email?: string;
  };
  googleOAuthState?: string;
  googleOAuthStateExpiresAt?: Date;
};

const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    username: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    timezone: { type: String, required: true, default: 'UTC' },
    googleCalendar: {
      refreshToken: { type: String, required: false },
      accessToken: { type: String, required: false },
      expiryDate: { type: Number, required: false },
      email: { type: String, required: false },
    },
    googleOAuthState: { type: String, required: false, index: true },
    googleOAuthStateExpiresAt: { type: Date, required: false },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model<UserDoc>('User', UserSchema);

