export type EventType = 'Ride' | 'Workout'
export type PlanEvent = {
  external_id: string
  start_date_local: string      // ISO local
  type: EventType
  category: 'WORKOUT'
  moving_time: number           // seconds
  icu_training_load: number
  description?: string
  name: string                  // required by Intervals upload path
  data?: any                    // optional design/spec
}

export type WeekPlan = {
  week_start: string            // YYYY-MM-DD (Sunday)
  events: PlanEvent[]
}
