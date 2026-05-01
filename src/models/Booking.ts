/** Booking record model storing invitee details and confirmed time. */
import mongoose, { Schema, Types } from 'mongoose';

export type BookingDoc = {
  userId: Types.ObjectId;
  eventTypeId: Types.ObjectId;
  inviteeName: string;
  inviteeEmail: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string; // invitee tz
  status: 'confirmed' | 'cancelled';
  cancelReason?: string;
};

const BookingSchema = new Schema<BookingDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventTypeId: { type: Schema.Types.ObjectId, ref: 'EventType', required: true, index: true },
    inviteeName: { type: String, required: true, trim: true },
    inviteeEmail: { type: String, required: true, lowercase: true, trim: true },
    startUtc: { type: Date, required: true, index: true },
    endUtc: { type: Date, required: true, index: true },
    timezone: { type: String, required: true, default: 'UTC' },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
    cancelReason: { type: String },
  },
  { timestamps: true },
);

// Prevent double-booking overlapping slots per user
BookingSchema.index({ userId: 1, startUtc: 1, endUtc: 1 }, { unique: true });

export const BookingModel = mongoose.model<BookingDoc>('Booking', BookingSchema);

