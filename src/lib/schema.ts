/* src/lib/schema.ts */

import { z } from "zod";

export const zPlanEvent = z.object({
  external_id: z.string().min(1),
  start_date_local: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "YYYY-MM-DDTHH:MM"),
  type: z.enum(["Ride", "Workout", "Run", "Swim", "Virtual Ride"]).default("Ride"),
  category: z.enum(["WORKOUT", "RACE", "OTHER"]).default("WORKOUT"),
  moving_time: z.number().int().nonnegative(),
  icu_training_load: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const zWeekPlan = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  events: z.array(zPlanEvent),
});

export type PlanEvent = z.infer<typeof zPlanEvent>;
export type WeekPlan  = z.infer<typeof zWeekPlan>;

export function parseWeekPlan(input: unknown): WeekPlan {
  return zWeekPlan.parse(input);
}
