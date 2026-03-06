import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopNav } from '../components/TopNav'
import { NewProjectModal } from '../components/NewProjectModal'
import { LeftSidebar } from '../components/LeftSidebar'
import { CueDetector } from '../components/CueDetector'
import { BottomBar } from '../components/BottomBar'
import { useJobPoller } from '../hooks/useJobPoller'
import { uploadFile, runDetection, getIndexedVideos } from '../api/client'
import type { JobResponse } from '../api/client'
import type { Project, UploadedVideo, IndexedVideo, DetectionPattern, JobState } from '../types'

const STORAGE_KEY = 'insightcuts_project'

export function loadSavedProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Project) : null
  } catch {
    return null
  }
}

function saveProject(p: Project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise(resolve => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v.duration)
    v.onerror = () => resolve(0)
    v.src = url
  })
}

const INITIAL_JOB: JobState = { jobId: '', status: 'idle', patterns: [] }

export function WorkspacePage() {
  const navigate = useNavigate()

  // If the Slack OAuth callback landed here with ?slack=connected, redirect
  // back to wherever the user was (editor page) so they don't lose progress.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const slackParam = params.get('slack')
    if (!slackParam) return
    window.history.replaceState({}, '', window.location.pathname)
    if (slackParam === 'connected') {
      const returnUrl = localStorage.getItem('slack-return-url')
      localStorage.removeItem('slack-return-url')
      if (returnUrl) {
        const sep = returnUrl.includes('?') ? '&' : '?'
        window.location.replace(`${returnUrl}${sep}slack=connected`)
      }
    }
  }, [])
  const [project, setProject] = useState<Project | null>(loadSavedProject)
  const [showModal, setShowModal] = useState(() => !loadSavedProject())
  const [videos, setVideos] = useState<UploadedVideo[]>([])
  const [indexedVideos, setIndexedVideos] = useState<IndexedVideo[]>([])
  const [uploading, setUploading] = useState(false)
  const [jobState, setJobState] = useState<JobState>(INITIAL_JOB)
  const [query, setQuery] = useState('')

  useEffect(() => {
    getIndexedVideos()
      .then(({ videos: indexed }) =>
        setIndexedVideos(indexed.map(v => ({ ...v, selected: false })))
      )
      .catch(() => {/* non-fatal — indexed videos panel stays empty */})
  }, [])

  const handleJobUpdate = useCallback((job: JobResponse) => {
    setJobState(prev => {
      if (job.status === 'review' && job.detection?.matches) {
        const patterns: DetectionPattern[] = job.detection.matches.map((m, i) => ({
          id: String(i),
          label: `${formatTime(m.gestureTimestamp)} — ${m.confidence} confidence (${Math.round(m.end - m.start)}s)`,
          selected: true,
          matchIndex: i,
          gestureTimestamp: m.gestureTimestamp,
          start: m.start,
          end: m.end,
          confidence: m.confidence,
        }))
        return { ...prev, status: 'review', patterns }
      }
      if (job.status === 'error') {
        return { ...prev, status: 'error', error: job.error }
      }
      return { ...prev, status: job.status }
    })
  }, [])

  useJobPoller(jobState.status === 'detecting' ? jobState.jobId : null, handleJobUpdate)

  const handleCreateProject = useCallback((name: string) => {
    const p: Project = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    saveProject(p)
    setProject(p)
    setShowModal(false)
  }, [])

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const previewUrl = URL.createObjectURL(file)
      const [duration, uploaded] = await Promise.all([
        getVideoDuration(previewUrl),
        uploadFile(file),
      ])
      setVideos(prev => [
        ...prev,
        {
          fileId: uploaded.fileId,
          filePath: uploaded.filePath,
          originalName: uploaded.originalName,
          size: uploaded.size,
          selected: true,
          previewUrl,
          duration,
        },
      ])
    } catch (err) {
      console.error('[WorkspacePage] upload failed:', err)
    } finally {
      setUploading(false)
    }
  }, [])

  const handleToggleVideo = useCallback((fileId: string) => {
    setVideos(prev => prev.map(v => (v.fileId === fileId ? { ...v, selected: !v.selected } : v)))
  }, [])

  const handleToggleIndexedVideo = useCallback((fileId: string) => {
    setIndexedVideos(prev => prev.map(v => (v.fileId === fileId ? { ...v, selected: !v.selected } : v)))
  }, [])

  const runDetectionAndNavigate = useCallback(
    async (q: string) => {
      const selectedUploaded = videos.filter(v => v.selected)
      const selectedIndexed = indexedVideos.filter(v => v.selected)

      if (!selectedUploaded.length && !selectedIndexed.length) {
        alert('Select at least one video before searching.')
        return
      }

      // Prefer an already-indexed video (no re-upload); fall back to a freshly uploaded one
      const useIndexed = selectedIndexed.length > 0
      const filePath = useIndexed ? selectedIndexed[0].filePath : selectedUploaded[0].filePath

      try {
        const { jobId } = await runDetection({
          filePath,
          gestureQuery: q,
          generateNarration: false,
          generatePodcast: false,
          ...(useIndexed && {
            existingVideoId: selectedIndexed[0].videoId,
            existingIndexId: selectedIndexed[0].indexId,
            existingHlsUrl:  selectedIndexed[0].hlsUrl,
          }),
        })
        setJobState({ jobId, status: 'detecting', patterns: [] })
        navigate(`/processing/${jobId}`, { state: { projectName: project?.name } })
      } catch (err) {
        console.error('[detection] failed:', err)
        setJobState(prev => ({ ...prev, status: 'error', error: String(err) }))
      }
    },
    [videos, indexedVideos, navigate, project],
  )

  const handleQuery = useCallback(
    async (q: string) => {
      await runDetectionAndNavigate(q)
    },
    [runDetectionAndNavigate],
  )

  const handleTogglePattern = useCallback((patternId: string) => {
    setJobState(prev => ({
      ...prev,
      patterns: prev.patterns.map(p => (p.id === patternId ? { ...p, selected: !p.selected } : p)),
    }))
  }, [])

  // If detection has run, count selected patterns; otherwise count selected videos (uploaded + indexed)
  const selectedPatternCount = jobState.patterns.filter(p => p.selected).length
  const selectedCount =
    jobState.patterns.length > 0
      ? selectedPatternCount
      : videos.filter(v => v.selected).length + indexedVideos.filter(v => v.selected).length

  const handleWrapUp = useCallback(async () => {
    if (!project) return

    if (jobState.status === 'review') {
      // Detection done — go straight to editor for clip review
      navigate(`/editor/${jobState.jobId}`, { state: { projectName: project.name } })
    } else if (query.trim()) {
      // No detection yet but query is typed — run detection then auto-assemble via ProcessingPage
      await runDetectionAndNavigate(query.trim())
    } else {
      alert("Enter a query describing what you're looking for before wrapping up.")
    }
  }, [jobState, query, project, navigate, runDetectionAndNavigate])

  return (
    <>
      {showModal && (
        <NewProjectModal
          onClose={project ? () => setShowModal(false) : undefined}
          onSubmit={handleCreateProject}
        />
      )}
      {project && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <TopNav onNewProject={() => setShowModal(true)} />
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <LeftSidebar
              projectName={project.name}
              videos={videos}
              uploading={uploading}
              onUpload={handleUpload}
              onToggleVideo={handleToggleVideo}
              indexedVideos={indexedVideos}
              onToggleIndexedVideo={handleToggleIndexedVideo}
            />
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <CueDetector
                jobState={jobState}
                query={query}
                onQueryChange={setQuery}
                onQuery={handleQuery}
                onTogglePattern={handleTogglePattern}
              />
              <BottomBar
                selectedCount={selectedCount}
                onWrapUp={handleWrapUp}
                isAssembling={jobState.status === 'assembling'}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
