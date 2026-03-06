// ─── InsightCuts API client ───────────────────────────────────────────────────
// Typed fetch wrappers for all backend endpoints used by the editor.

import type { EditorClip, SearchResult, SceneScript, InsightCard } from './types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface JobResponse {
  id: string
  status: 'detecting' | 'review' | 'assembling' | 'complete' | 'error'
  sourceDuration: number | null
  editorClips: EditorClip[] | null
  sourceVideoUrl?: string
  error?: string
}

export interface UploadResponse {
  fileId: string
  filePath: string
  originalName: string
  size: number
  fileType?: string
  duplicate?: boolean
}

export interface RawInsight {
  id: string
  text: string
  source: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText)
    throw new Error(`API ${init?.method ?? 'GET'} ${url} → ${r.status}: ${text}`)
  }
  return r.json() as Promise<T>
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/** Fetch full job state including editorClips and sourceDuration. */
export function fetchJob(jobId: string): Promise<JobResponse> {
  return apiFetch(`/api/jobs/${jobId}`)
}

/** Upload a single file; returns the server-side filePath for subsequent API calls. */
export function uploadFile(file: File): Promise<UploadResponse> {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch('/api/upload', { method: 'POST', body: fd })
}

/** Extract research insights from already-uploaded document files (by server path). */
export function extractInsightsApi(documentPaths: string[]): Promise<{ insights: RawInsight[] }> {
  return apiFetch('/api/extract-insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentPaths }),
  })
}

/** Search the job's indexed video for additional clips matching query. */
export function searchClipsApi(jobId: string, query: string): Promise<{ results: SearchResult[] }> {
  return apiFetch(`/api/jobs/${jobId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
}

/** Generate GPT-4o Vision narration scripts for selected clips only. */
export function generateNarrationScriptApi(
  jobId: string,
  selectedIndices: number[],
  clipInsights?: Record<string, string[]>,
  clipBoundaries?: Record<string, { start: number; end: number }>,
): Promise<{ scripts: SceneScript[] }> {
  return apiFetch(`/api/jobs/${jobId}/narration/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedIndices,
      ...(clipInsights ? { clipInsights } : {}),
      ...(clipBoundaries ? { clipBoundaries } : {}),
    }),
  })
}

/** Generate a podcast script from the job's research documents. */
export function generatePodcastScriptApi(
  jobId: string,
  documentPaths?: string[],
): Promise<{ script: string }> {
  return apiFetch(`/api/jobs/${jobId}/podcast/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(documentPaths?.length ? { documentPaths } : {}),
  })
}

/** Render a podcast script to audio via ElevenLabs. Returns a download URL. */
export function renderPodcastApi(
  jobId: string,
  script: string,
  voice?: string,
): Promise<{ podcastUrl: string }> {
  return apiFetch(`/api/jobs/${jobId}/podcast/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, ...(voice ? { voice } : {}) }),
  })
}

/** Refine an existing narration script with a user instruction. */
export function refineNarrationScriptApi(
  jobId: string,
  script: string,
  instruction: string,
): Promise<{ script: string }> {
  return apiFetch(`/api/jobs/${jobId}/narration/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, instruction }),
  })
}

/** Rewrite a single insight finding with a user instruction. */
export function refineInsightApi(
  insightText: string,
  instruction: string,
): Promise<{ text: string }> {
  return apiFetch('/api/insights/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ insightText, instruction }),
  })
}

/** Map a raw backend insight (flat text) to the frontend InsightCard shape. */
export function mapRawInsight(r: RawInsight): Omit<InsightCard, 'added' | 'addedToClipIndex'> {
  const dotIdx = r.text.indexOf('. ')
  const title       = dotIdx > -1 ? r.text.slice(0, dotIdx) : r.text
  const description = dotIdx > -1 ? r.text.slice(dotIdx + 2) : ''
  return { id: r.id, title, description, source: r.source }
}
