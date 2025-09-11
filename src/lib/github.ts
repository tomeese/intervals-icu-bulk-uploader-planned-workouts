/* src/lib/github.ts */

export type GhCfg = { token:string; owner:string; repo:string; branch:string; }

const headers = (t:string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${t}`,
})

export async function getFile(cfg: GhCfg, path: string) { /* GET /contents/:path */ }
export async function putFile(cfg: GhCfg, path: string, content: string, message:string) { /* PUT /contents/:path */ }
export async function listDir(cfg: GhCfg, path:string) { /* GET dir listing if needed */ }
// You can add repository_dispatch or workflow_dispatch calls later if you want “Upload to Intervals” from UI.
