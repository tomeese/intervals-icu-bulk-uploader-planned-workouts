/* src/lib/intervals.ts */

import { WeekPlan } from './schema'
export function toIntervalsPayload(plan: WeekPlan) {
  // shape exactly what your Python uploader expects (it’s already working)
  return plan
}
