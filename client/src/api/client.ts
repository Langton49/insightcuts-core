const BASE = '/api'

export interface UploadResponse {
  fileId: string
  filePath: string
  originalName: string
  size: number
  fileType: 'video' | 'document'
  duplicate?: boolean
}

export interface RunDetectionRequest {
  filePath: string
  gestureQuery: string
  indexName?: string
  clipBefore?: number
  clipAfter?: number
  maxClips?: number
  title?: string
  subtitle?: string
  confidenceFilter?: string[]
  keepIndexed?: boolean
  documentPaths?: string[]
  generateNarration?: boolean
  generatePodcast?: boolean
  existingVideoId?: string
  existingIndexId?: string
  existingHlsUrl?: string | null
}

export interface IndexedVideo {
  fileId: string
  filePath: string
  originalName: string
  size: number
  videoId: string
  hlsUrl: string | null
  indexId: string
  thumbnailUrl?: string
}

export interface GestureMatch {
  videoId: string
  score: number
  confidence: string
  start: number
  end: number
  gestureTimestamp: number
  thumbnailUrl?: string
}

export interface JobResponse {
  id: string
  status: 'detecting' | 'review' | 'assembling' | 'complete' | 'error'
  startedAt: string
  config: Record<string, unknown>
  detection?: {
    indexId: string
    videoId: string
    hlsUrl: string | null
    matches: GestureMatch[]
  }
  assembly?: {
    briefPath: string
    briefDuration: number
    podcastPath?: string
  }
  error?: string
}

export interface AssembleRequest {
  selectedIndices?: number[]
  clipBoundaries?: Record<string, { start: number; end: number }>
  clipInsights?: Record<string, string[]>
  generateNarration?: boolean
  generatePodcast?: boolean
  narrationVoice?: string
  globalLayout?: string
  clipLayouts?: Record<string, string>
  /** Pre-generated narration scripts: clip index (as string) → script text.
   *  When provided, assembly skips GPT-4o Vision and uses these directly. */
  narrationScripts?: Record<string, string>
  /** Background music track ID selected in MusicPanel — mixed into brief.mp4 at low volume */
  backgroundTrackId?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text)
  }
  return res.json() as Promise<T>
}

export function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  return request<UploadResponse>('/upload', { method: 'POST', body: form })
}

export function runDetection(req: RunDetectionRequest): Promise<{ jobId: string }> {
  return request<{ jobId: string }>('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/jobs/${jobId}`)
}

export function getIndexedVideos(): Promise<{ videos: IndexedVideo[] }> {
  return request<{ videos: IndexedVideo[] }>('/indexed-videos')
}

export function startAssembly(jobId: string, config: AssembleRequest): Promise<{ jobId: string }> {
  return request<{ jobId: string }>(`/jobs/${jobId}/assemble`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}
