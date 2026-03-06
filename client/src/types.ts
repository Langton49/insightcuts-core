export interface Project {
  id: string
  name: string
  createdAt: string
}

export interface UploadedVideo {
  fileId: string
  filePath: string      // server-side absolute path (used for /api/run)
  originalName: string
  size: number
  selected: boolean
  previewUrl?: string   // client-side blob URL for thumbnail
  duration?: number     // seconds, from <video> metadata
}

export interface IndexedVideo {
  fileId: string
  filePath: string      // server-side absolute path (used for /api/run)
  originalName: string
  size: number
  videoId: string       // Twelve Labs video ID — already indexed, skip upload
  hlsUrl: string | null
  indexId: string       // Twelve Labs index ID
  thumbnailUrl?: string // URL to stream the file for thumbnail frame capture
  selected: boolean
}

export interface DetectionPattern {
  id: string            // match index as string
  label: string         // human-readable label
  selected: boolean
  matchIndex: number    // index in job.detection.matches
  gestureTimestamp: number
  start: number
  end: number
  confidence: string
}

export type JobStatus = 'idle' | 'detecting' | 'review' | 'assembling' | 'complete' | 'error'

export type LayoutStyle =
  | 'split-screen'
  | 'bottom-top'
  | 'overlay'
  | 'picture-in-picture'
  | 'sequential'

export interface EditorClip {
  index: number           // 0-based, maps to /clips/:index endpoint
  sceneLabel: string      // "Scene 1", "Scene 2" etc.
  start: number           // start time in SOURCE video (seconds)
  duration: number        // clip duration in seconds
  confidence: string      // 'high' | 'medium' | 'low'
  thumbnailUrl?: string
  selected: boolean
  layoutStyle?: LayoutStyle // per-clip override; undefined = use global layout
  sourceVideoUrl?: string   // URL of the source video this clip was cut from
  sourceDuration?: number   // total duration of the source video (for scrubber bounds)
}

export interface SearchResult {
  tempId: string          // uuid for key
  start: number           // start in source video
  duration: number        // clip duration
  confidence: string
  thumbnailUrl?: string
  sourceVideoUrl?: string // URL of the source video this result came from
  sourceDuration?: number // total duration of that source video
}

export interface SceneScript {
  clipIndex: number
  sceneLabel: string
  script: string
}

export interface VoiceOption {
  id: string
  label: string
}

export interface InsightCard {
  id: string
  title: string
  description: string
  source: string                   // filename the insight came from
  added: boolean
  addedToClipIndex: number | null  // null = unattached
}

export interface JobState {
  jobId: string
  status: JobStatus
  patterns: DetectionPattern[]
  error?: string
}
