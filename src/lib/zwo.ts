/* src/lib/zwo.ts */

export function specFromWorkout(e: { icu_training_load:number; moving_time:number; description?:string }) {
  // Map your description hints → ZWO structure (as you had).
  return {/* … */}
}
export function makeZwoXML(spec:any, title:string){/* … */}
export function download(filename:string, content:string, mime="application/xml"){/* … */}
