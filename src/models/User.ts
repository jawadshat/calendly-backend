import mongoose, { Schema } from 'mongoose';

export type UserDoc = {
  email: string;
  passwordHash: string;
  username: string; // public slug
  displayName: string;
  timezone: string; // IANA name, e.g. "America/New_York"
};

const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    username: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    timezone: { type: String, required: true, default: 'UTC' },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model<UserDoc>('User', UserSchema);

