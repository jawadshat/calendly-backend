/** Event type model defining host-owned public meeting templates. */
import mongoose, { Schema, Types } from 'mongoose';

export type EventTypeDoc = {
  userId: Types.ObjectId;
  slug: string; // used in public URL
  title: string;
  description?: string;
  durationMinutes: number;
  locationType: 'google_meet' | 'zoom' | 'phone' | 'in_person' | 'custom';
  isActive: boolean;
};

const EventTypeSchema = new Schema<EventTypeDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slug: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    durationMinutes: { type: Number, required: true, min: 5, max: 480 },
    locationType: {
      type: String,
      enum: ['google_meet', 'zoom', 'phone', 'in_person', 'custom'],
      default: 'google_meet',
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

EventTypeSchema.index({ userId: 1, slug: 1 }, { unique: true });

export const EventTypeModel = mongoose.model<EventTypeDoc>('EventType', EventTypeSchema);

