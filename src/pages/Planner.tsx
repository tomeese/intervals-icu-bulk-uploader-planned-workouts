import React, { useMemo, useReducer, useState } from 'react'
import { reducer, buildWeekPlan } from '../lib/planner-state'
import type { PlannerState } from '../lib/planner-state'
import { zWeekPlan, type WeekPlan as PlanWeek, type PlanEvent as PlanEventZ } from '../lib/schema'
import {
  computeGuardrails,
  sumPlannedLoad,
  DEFAULT_GUARDRAILS,
  type WeekPlan as GRWeek,
  type WorkoutEvent as GREvent,
} from '../lib/guardrails'
import { putFile, type GhCfg } from '../lib/github'
import { download } from '../lib/zwo'

// ---------- local helpers ----------
type PlanEvent = PlanEventZ // shorthand

function isoOf(date: Date) {
  return date.toISOString().slice(0, 10)
}
function dayIso(weekStart: string, dayIndex: number) {
  const d = new Date(`${weekStart}T00:00:00`)
  d.setDate(d.getDate() + dayIndex)
  return isoOf(d)
}
function nextSunday(iso: string, deltaWeeks: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + 7 * deltaWeeks)
  return isoOf(d)
}
function ensureHHMM(s: string) {
  return /^\d{2}:\d{2}$/.test(s) ? s : '06:00'
}
function mkExternalId(dateIso: string, load: number, secs: number) {
  return `${dateIso}-${load}-${secs}`
}
function toGRWeek(plan: PlanWeek): GRWeek {
  // guardrails lib doesn’t require "name", so we can cast the shared fields across
  return {
    week_start: plan.week_start,
    events: plan.events.map(e => ({
      external_id: e.external_id,
      start_date_local: e.start_date_local,
      type: e.type as GREvent['type'],
      category: 'WORKOUT',
      moving_time: e.moving_time,
      icu_training_load: e.icu_training_load,
      description: e.description,
    })),
  }
}

function useInitialPlannerState(): PlannerState {
  const today = new Date()
  const dow = today.getDay() // Sun=0..Sat=6
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - dow)
  const weekStart = isoOf(sunday)
  return {
    weekStart,
    selectedDay: Math.min(dow, 6),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    days: {}, // empty week to start
  }
}

// ---------- UI pieces ----------
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </div>
  )
}

function Field({
  label, children,
}: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </label>
  )
}

// ---------- Main component ----------
export default function Planner() {
  const [state, dispatch] = useReducer(reducer, undefined, useInitialPlannerState)
  const [ghToken, setGhToken] = useState<string>(() => localStorage.getItem('gh_pat') || '')
  const [ghOwner, setGhOwner] = useState<string>(() => import.meta.env.VITE_GH_OWNER || '')
  const [ghRepo, setGhRepo] = useState<string>(() => import.meta.env.VITE_GH_REPO || '')
  const [ghBranch, setGhBranch] = useState<string>(() => import.meta.env.VITE_GH_BRANCH || 'main')

  // quick add form state (per selected day)
  const [form, setForm] = useState({
    time: '06:00',
    type: 'Ride' as PlanEvent['type'],
    name: '',
    load: 60,
    minutes: 90,
    description: '',
  })

  const weekPlan: PlanWeek = useMemo(() => buildWeekPlan(state), [state])
  const guardrails = useMemo(() => computeGuardrails(toGRWeek(weekPlan), { previousPlannedWeeks: [] }, DEFAULT_GUARDRAILS), [weekPlan])

  const total = useMemo(() => sumPlannedLoad(toGRWeek(weekPlan)), [weekPlan])
  const days = Array.from({ length: 7 }, (_, i) => dayIso(weekPlan.week_start, i))

  function handleChangeWeek(iso: string) {
    dispatch({ type: 'setWeekStart', weekStart: iso })
  }

  function addEvent(dateIso: string) {
    const secs = Math.max(0, Math.round(form.minutes * 60))
    const load = Math.max(0, Math.round(form.load))
    const startTime = ensureHHMM(form.time)
    const ev: PlanEvent = {
      external_id: mkExternalId(dateIso, load, secs),
      start_date_local: `${dateIso}T${startTime}`,
      type: form.type,
      category: 'WORKOUT',
      moving_time: secs,
      icu_training_load: load,
      description: form.description || (form.type === 'Workout' ? 'Structured workout' : 'Endurance'),
      name: form.name || (form.type === 'Workout' ? 'Workout' : 'Endurance Ride'),
    }
    dispatch({ type: 'addEvent', date: dateIso, event: ev })
  }

  function removeEvent(dateIso: string, idx: number) {
    dispatch({ type: 'removeEvent', date: dateIso, index: idx })
  }

  function onExportJSON() {
    const plan = buildWeekPlan(state)
    const parsed = WeekPlanSchema.parse(plan) // throws if invalid
    const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })
    const fname = `week-${parsed.week_start}.json`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fname
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function onSaveToGitHub() {
    try {
      if (!ghToken || !ghOwner || !ghRepo) {
        alert('GitHub config incomplete. Provide owner, repo, and a PAT.')
        return
      }
      localStorage.setItem('gh_pat', ghToken)

      const cfg: GhCfg = { token: ghToken, owner: ghOwner, repo: ghRepo, branch: ghBranch }
      const parsed = WeekPlanSchema.parse(weekPlan)
      const path = `snapshots/week-${parsed.week_start}.json`
      const content = JSON.stringify(parsed, null, 2)
      const message = `chore(snapshots): add ${path}`

      await putFile(cfg, path, content, message)
      alert(`Saved ${path} to ${ghOwner}/${ghRepo}@${ghBranch}`)
    } catch (err: any) {
      console.error(err)
      alert(`Save failed: ${err?.message || err}`)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <h1 className="text-2xl font-semibold">Weekly Planner</h1>

      {/* Week controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="px-3 py-1.5 rounded border border-slate-300"
          onClick={() => handleChangeWeek(nextSunday(weekPlan.week_start, -1))}
          aria-label="Previous week"
        >
          ← Prev
        </button>
        <input
          type="date"
          className="rounded border border-slate-300 px-2 py-1"
          value={weekPlan.week_start}
          onChange={(e) => handleChangeWeek(e.target.value)}
        />
        <button
          className="px-3 py-1.5 rounded border border-slate-300"
          onClick={() => handleChangeWeek(nextSunday(weekPlan.week_start, +1))}
          aria-label="Next week"
        >
          Next →
        </button>

        <div className="ml-auto flex gap-2">
          <button className="px-3 py-1.5 rounded border border-slate-300" onClick={onExportJSON}>
            Export JSON
          </button>
          <button className="px-3 py-1.5 rounded border border-slate-300" onClick={onSaveToGitHub}>
            Save to GitHub (snapshots/)
          </button>
        </div>
      </div>

      {/* Guardrails + Totals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SectionCard title="Totals">
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span>Planned week load</span><span className="font-medium">{total}</span></div>
            <div className="flex justify-between"><span>Baseline weekly</span><span className="font-medium">{guardrails.baselineWeeklyLoad}</span></div>
            <div className="flex justify-between"><span>Ramp %</span><span className="font-medium">{guardrails.rampPct.toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Severity</span><span className="font-medium">{guardrails.rampSeverity}</span></div>
          </div>
        </SectionCard>

        <SectionCard title="Daily caps (breaches)">
          <ul className="list-disc pl-5 text-sm space-y-1">
            {guardrails.daily.map((d) => {
              const any = (d.breaches?.length || 0) > 0
              return (
                <li key={d.date} className={any ? 'text-red-600' : 'text-slate-600'}>
                  {d.date}: {d.dayType} {any ? `— over by ${d.overBy} (cap ${d.capApplied})` : '— ok'}
                </li>
              )
            })}
          </ul>
        </SectionCard>

        <SectionCard title="GitHub settings">
          <div className="grid grid-cols-1 gap-2">
            <Field label="Owner">
              <input className="rounded border border-slate-300 px-2 py-1" value={ghOwner} onChange={e=>setGhOwner(e.target.value)} />
            </Field>
            <Field label="Repo">
              <input className="rounded border border-slate-300 px-2 py-1" value={ghRepo} onChange={e=>setGhRepo(e.target.value)} />
            </Field>
            <Field label="Branch">
              <input className="rounded border border-slate-300 px-2 py-1" value={ghBranch} onChange={e=>setGhBranch(e.target.value)} />
            </Field>
            <Field label="Personal Access Token (stored locally)">
              <input className="rounded border border-slate-300 px-2 py-1" type="password" value={ghToken} onChange={e=>setGhToken(e.target.value)} />
            </Field>
          </div>
        </SectionCard>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
        {days.map((dateIso, i) => {
          const events = state.days[dateIso] || []
          return (
            <div key={dateIso} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
              <div className="flex items-baseline justify-between mb-2">
                <div className="font-medium">{dateIso}</div>
                <div className="text-xs text-slate-500">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}</div>
              </div>

              <ul className="space-y-2 mb-3">
                {events.length === 0 && <li className="text-sm text-slate-500">No events</li>}
                {events.map((e, idx) => (
                  <li key={`${e.external_id}-${idx}`} className="text-sm rounded border border-slate-200 p-2">
                    <div className="font-medium">{e.name || (e.type === 'Workout' ? 'Workout' : 'Endurance Ride')}</div>
                    <div className="text-slate-600">
                      {e.type} • TL {e.icu_training_load} • {Math.round(e.moving_time/60)} min • {e.start_date_local.slice(11,16)}
                    </div>
                    {e.description && <div className="text-xs text-slate-500 mt-1">{e.description}</div>}
                    <div className="mt-2">
                      <button className="text-xs px-2 py-0.5 rounded border border-slate-300" onClick={()=>removeEvent(dateIso, idx)}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Quick add */}
              <div className="space-y-2">
                <Field label="Type">
                  <select
                    className="rounded border border-slate-300 px-2 py-1"
                    value={form.type}
                    onChange={e=>setForm(f=>({...f, type: e.target.value as PlanEvent['type']}))}
                  >
                    <option>Ride</option>
                    <option>Workout</option>
                  </select>
                </Field>
                <Field label="Name (optional)">
                  <input className="rounded border border-slate-300 px-2 py-1" value={form.name} onChange={e=>setForm(f=>({...f, name: e.target.value}))} placeholder={form.type==='Workout' ? 'VO2 5x3’ @120%' : 'Endurance'} />
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Start">
                    <input className="rounded border border-slate-300 px-2 py-1" type="time" value={form.time} onChange={e=>setForm(f=>({...f, time: e.target.value}))} />
                  </Field>
                  <Field label="TL">
                    <input className="rounded border border-slate-300 px-2 py-1" type="number" min={0} value={form.load} onChange={e=>setForm(f=>({...f, load: Number(e.target.value)}))} />
                  </Field>
                  <Field label="Minutes">
                    <input className="rounded border border-slate-300 px-2 py-1" type="number" min={0} value={form.minutes} onChange={e=>setForm(f=>({...f, minutes: Number(e.target.value)}))} />
                  </Field>
                </div>
                <Field label="Description (optional)">
                  <input className="rounded border border-slate-300 px-2 py-1" value={form.description} onChange={e=>setForm(f=>({...f, description: e.target.value}))} />
                </Field>
                <button className="w-full mt-1 px-3 py-1.5 rounded border border-slate-300" onClick={()=>addEvent(dateIso)}>
                  Add to {dateIso}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
