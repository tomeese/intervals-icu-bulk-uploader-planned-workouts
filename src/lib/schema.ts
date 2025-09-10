import { z } from "zod";

// Inclusive language: allowlist of supported types
export const ALLOWLIST_TYPES = ["Ride", "Gravel Ride", "Virtual Ride", "Run", "Swim", "Workout"] as const;

export const zEvent = z.object({
  external_id: z.string().min(1),
  start_date_local: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "expect YYYY-MM-DDTHH:MM (local time, no Z)"),
  type: z.enum(ALLOWLIST_TYPES),
  category: z.literal("WORKOUT"),
  moving_time: z.number().int().nonnegative(),
  icu_training_load: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),        // uploader will fill if missing
  description: z.string().optional(),
});

export const zWeekPlan = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expect YYYY-MM-DD"),
  events: z.array(zEvent),
});

export type ZEvent = z.infer<typeof zEvent>;
export type ZWeekPlan = z.infer<typeof zWeekPlan>;
