import mongoose, { Schema, Types } from 'mongoose';

export type WeeklyHours = {
  // 0=Sunday ... 6=Saturday
  dayOfWeek: number;
  // minutes since 00:00 in host timezone
  startMinute: number;
  endMinute: number;
};

export type AvailabilityDoc = {
  userId: Types.ObjectId;
  eventTypeId?: Types.ObjectId;
  timezone: string;
  weekly: WeeklyHours[];
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysInFuture: number;
};

const WeeklyHoursSchema = new Schema<WeeklyHours>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startMinute: { type: Number, required: true, min: 0, max: 24 * 60 - 1 },
    endMinute: { type: Number, required: true, min: 1, max: 24 * 60 },
  },
  { _id: false },
);

const AvailabilitySchema = new Schema<AvailabilityDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventTypeId: { type: Schema.Types.ObjectId, ref: 'EventType', required: false },
    timezone: { type: String, required: true, default: 'UTC' },
    weekly: { type: [WeeklyHoursSchema], default: [] },
    bufferBeforeMinutes: { type: Number, default: 0, min: 0, max: 240 },
    bufferAfterMinutes: { type: Number, default: 0, min: 0, max: 240 },
    minNoticeMinutes: { type: Number, default: 60, min: 0, max: 7 * 24 * 60 },
    maxDaysInFuture: { type: Number, default: 60, min: 1, max: 365 },
  },
  { timestamps: true },
);

// One dedicated availability per event type.
AvailabilitySchema.index(
  { eventTypeId: 1 },
  {
    name: 'eventTypeId_unique_partial',
    unique: true,
    partialFilterExpression: { eventTypeId: { $exists: true } },
  },
);

export const AvailabilityModel = mongoose.model<AvailabilityDoc>('Availability', AvailabilitySchema);

