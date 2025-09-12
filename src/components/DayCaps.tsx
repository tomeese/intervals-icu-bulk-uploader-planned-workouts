/* src/components/DayCaps.tsx */

import React from "react";
import { checkDay, DEFAULT_GUARDRAILS, type WorkoutEvent } from "../lib/guardrails";

export function DayCaps({ date, events }: { date: string; events: WorkoutEvent[] }) {
  if (!events?.length) return null;

  const res = checkDay({ date, events } as any, DEFAULT_GUARDRAILS);
  if (!res || res.overBy <= 0) return null;

  // minimal styling to leverage existing tailwind setup
  const chip = (txt: string) => (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border">
      {txt}
    </span>
  );

  return (
    <div className="mt-1 flex flex-wrap gap-1 text-xs">
      {chip(`${res.dayType} cap ${res.capApplied}`)}
      {chip(`+${res.overBy}`)}
      {res.breaches?.map((b: string) => (
        <span key={b} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 border border-amber-200 text-amber-700">
          {b.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}
