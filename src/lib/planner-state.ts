/* src/lib/planner-state.ts */

import { WeekPlan, PlanEvent } from './schema'

export type PlannerState = {
  weekStart: string | null
  selectedDay: number // 0..6
  tz: string
  days: Record<string, PlanEvent[]>
}

type Action =
  | { type: 'setWeekStart'; weekStart: string }
  | { type: 'selectDay'; index: number }
  | { type: 'addEvent'; date: string; event: PlanEvent }
  | { type: 'removeEvent'; date: string; index: number }
  | { type: 'replaceDay'; date: string; events: PlanEvent[] }
  | { type: 'loadWeek'; plan: WeekPlan }

export function reducer(s: PlannerState, a: Action): PlannerState {
  switch (a.type) {
    case 'setWeekStart':
      return { ...s, weekStart: a.weekStart }
    case 'selectDay':
      return { ...s, selectedDay: a.index }
    case 'addEvent':
      return { ...s, days: { ...s.days, [a.date]: [ ...(s.days[a.date] || []), a.event ] } }
    case 'removeEvent': {
      const copy = [ ...(s.days[a.date] || []) ]
      copy.splice(a.index, 1)
      return { ...s, days: { ...s.days, [a.date]: copy } }
    }
    case 'replaceDay':
      return { ...s, days: { ...s.days, [a.date]: a.events } }
    case 'loadWeek': {
      const days: PlannerState['days'] = {}
      for (const e of a.plan.events) {
        const date = e.start_date_local.slice(0, 10)
        ;(days[date] ||= []).push(e)
      }
      return { ...s, weekStart: a.plan.week_start, days }
    }
  }
}

/** Build a WeekPlan JSON blob from UI state. */
export function buildWeekPlan(state: PlannerState): WeekPlan {
  const events: PlanEvent[] = []
  for (const arr of Object.values(state.days)) {
    for (const e of arr) events.push(e)
  }
  const week_start = state.weekStart || inferSunday()
  return { week_start, events: sortByDateTime(events) }
}

/** Return the Sunday (YYYY-MM-DD) for today or a given reference date. */
export function inferSunday(referenceIso?: string): string {
  const ref = referenceIso ? isoToDate(referenceIso) : new Date()
  // Use local dates to avoid TZ drift; force to noon to dodge DST edges
  const local = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12, 0, 0, 0)
  const dow = local.getDay() // Sun=0..Sat=6
  const sunday = new Date(local.getFullYear(), local.getMonth(), local.getDate() - dow, 12, 0, 0, 0)
  return fmtISODate(sunday)
}

/** Given a weekStart (YYYY-MM-DD), return YYYY-MM-DD for day index 0..6. */
export function dayIso(weekStart: string, idx: number): string {
  const d = isoToDate(weekStart)
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + idx, 12, 0, 0, 0)
  return fmtISODate(out)
}

/** Stable sort by start_date_local, then external_id. */
export function sortByDateTime(events: PlanEvent[]): PlanEvent[] {
  return [...events].sort((a, b) => {
    const tA = Date.parse(a.start_date_local)
    const tB = Date.parse(b.start_date_local)
    if (tA !== tB) return tA - tB
    // fallback tie-breakers to keep output deterministic
    if (a.external_id && b.external_id && a.external_id !== b.external_id) {
      return a.external_id < b.external_id ? -1 : 1
    }
    return 0
  })
}

// ---------- tiny date helpers (local-safe) ----------

function fmtISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function isoToDate(isoDate: string): Date {
  // Build using Y,M,D in local time to avoid UTC shifting
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0)
}
