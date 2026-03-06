import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { EditorTopNav } from '../components/EditorTopNav'
import { VideoPlayer } from '../components/VideoPlayer'
import type { VideoPlayerHandle } from '../components/VideoPlayer'
import { SourceTimeline } from '../components/SourceTimeline'
import { FindClipsPanel } from '../components/FindClipsPanel'
import { InsightsPanel } from '../components/InsightsPanel'
import { NarrationPanel, VOICES } from '../components/NarrationPanel'
import { PodcastPanel } from '../components/PodcastPanel'
import { LayoutsPanel } from '../components/LayoutsPanel'
import { MusicPanel } from '../components/MusicPanel'
import { EditorSidebar } from '../components/EditorSidebar'
import type { ActivePanel } from '../components/EditorSidebar'
import { ShareModal } from '../components/ShareModal'
import { loadSavedProject } from './WorkspacePage'
import type { EditorClip, SearchResult, InsightCard, SceneScript, LayoutStyle } from '../types'
import {
  fetchJob,
  uploadFile,
  extractInsightsApi,
  generateNarrationScriptApi,
  generatePodcastScriptApi,
  renderPodcastApi,
  mapRawInsight,
} from '../api'
import { startAssembly } from '../api/client'
import type { JobResponse } from '../api/client'
import { useJobPoller } from '../hooks/useJobPoller'

// ─── Overlap resolution ───────────────────────────────────────────────────────

/**
 * Given a sorted list of clips, trims each clip so it ends exactly where the
 * next one begins. Used only for the initial load of detected clips.
 */
function makeAdjacent(clips: EditorClip[]): EditorClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  const result: EditorClip[] = []
  for (const clip of sorted) {
    if (result.length > 0) {
      const prev = result[result.length - 1]
      const prevEnd = prev.start + prev.duration
      if (clip.start < prevEnd) {
        prev.duration = clip.start - prev.start
        if (prev.duration < 2) result.pop()
      }
    }
    result.push({ ...clip })
  }
  return result.map((c, i) => ({ ...c, sceneLabel: `Scene ${i + 1}` }))
}

/**
 * Inserts a new clip from a Find Clips result into the timeline.
 * If the desired position overlaps existing clips, the new clip is shifted
 * forward (in source-video time) until it fits — preserving all existing clips.
 */
function insertClipNoOverlap(clips: EditorClip[], result: SearchResult, nextIndex: number): EditorClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start)

  // Walk sorted clips; push placedStart forward past any overlap
  let placedStart = result.start
  for (const clip of sorted) {
    const clipEnd = clip.start + clip.duration
    const newEnd = placedStart + result.duration
    if (placedStart < clipEnd && newEnd > clip.start) {
      placedStart = clipEnd
    }
  }

  const newClip: EditorClip = {
    index: nextIndex,
    sceneLabel: '',
    start: placedStart,
    duration: result.duration,
    confidence: result.confidence,
    thumbnailUrl: result.thumbnailUrl,
    selected: true,
  }

  const all = [...sorted, newClip].sort((a, b) => a.start - b.start)
  return all.map((c, i) => ({ ...c, sceneLabel: `Scene ${i + 1}` }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function EditorPage() {
  const { jobId = 'demo' } = useParams<{ jobId: string }>()
  const { state } = useLocation()
  const projectName: string =
    (state as { projectName?: string } | null)?.projectName ??
    loadSavedProject()?.name ??
    'Your project'

  const [clips, setClips] = useState<EditorClip[]>([])
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null)
  const [sourceDuration, setSourceDuration] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [timelineVisible, setTimelineVisible] = useState(true)
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [addedResultIds, setAddedResultIds] = useState<Set<string>>(new Set())
  const [showShareModal, setShowShareModal] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [playheadPct, setPlayheadPct] = useState(0)

  // Insights state
  const [insights, setInsights] = useState<InsightCard[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [documentPaths, setDocumentPaths] = useState<string[]>([])

  // Narration state
  const [narrationScripts, setNarrationScripts] = useState<SceneScript[]>([])
  const [narrationLoading, setNarrationLoading] = useState(false)
  const [narrationVoice, setNarrationVoice] = useState(VOICES[0].id)

  // Podcast state
  const [podcastScript, setPodcastScript] = useState('')
  const [podcastLoading, setPodcastLoading] = useState(false)
  const [podcastVoice, setPodcastVoice] = useState(VOICES[0].id)
  const [podcastRendering, setPodcastRendering] = useState(false)
  const [podcastDownloadUrl, setPodcastDownloadUrl] = useState<string | null>(null)
  const [podcastError, setPodcastError] = useState<string | null>(null)

  // Narration unlock state (persisted)
  const [narrationUnlocked, setNarrationUnlocked] = useState<boolean>(() => {
    return localStorage.getItem('insightcuts-narration-unlocked') === 'true'
  })

  const handleUnlockNarration = useCallback(() => {
    localStorage.setItem('insightcuts-narration-unlocked', 'true')
    setNarrationUnlocked(true)
  }, [])

  // Persist clip selections and boundary edits across reloads
  useEffect(() => {
    if (jobId === 'demo' || clips.length === 0) return
    const toSave: Record<number, { selected: boolean; start: number; duration: number }> = {}
    clips.forEach(c => { toSave[c.index] = { selected: c.selected, start: c.start, duration: c.duration } })
    localStorage.setItem(`insightcuts-clips-${jobId}`, JSON.stringify(toSave))
  }, [clips, jobId])

  // Layout state
  const [globalLayout, setGlobalLayout] = useState<LayoutStyle>('split-screen')

  // Music state
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)

  const videoRef = useRef<VideoPlayerHandle>(null)
  const nextClipIndex = useRef(0)

  const selectedClip = clips[selectedIndex] ?? null

  // ── Load job on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    if (jobId === 'demo') return
    fetchJob(jobId)
      .then(data => {
        if (data.editorClips?.length) {
          let adjacent = makeAdjacent(data.editorClips)
          // Restore persisted clip edits (selections + boundary trims)
          try {
            const saved = localStorage.getItem(`insightcuts-clips-${jobId}`)
            if (saved) {
              const savedMap = JSON.parse(saved) as Record<string, { selected: boolean; start: number; duration: number }>
              adjacent = adjacent.map(c => {
                const s = savedMap[c.index]
                return s ? { ...c, selected: s.selected, start: s.start, duration: s.duration } : c
              })
            }
          } catch { /* ignore corrupted data */ }
          setClips(adjacent)
          nextClipIndex.current = adjacent.length
        }
        if (data.sourceDuration) {
          setSourceDuration(data.sourceDuration)
        }
        setSourceVideoUrl(data.sourceVideoUrl ?? `/api/output/${jobId}/source`)
      })
      .catch(err => console.error('[EditorPage] fetchJob failed:', err))
  }, [jobId])

  // ── Clip handlers ───────────────────────────────────────────────────────────

  const handleSelectClip = useCallback((idx: number) => {
    setSelectedIndex(idx)
    setVideoCurrentTime(0)
    setIsPlaying(false)
    videoRef.current?.reset()
  }, [])

  const handleTimeUpdate = useCallback(
    (time: number) => {
      setVideoCurrentTime(time)
      if (selectedClip && sourceDuration > 0) {
        setPlayheadPct((selectedClip.start + time) / sourceDuration)
      }
    },
    [selectedClip, sourceDuration],
  )

  const handleDurationChange = useCallback((duration: number) => {
    setSourceDuration(prev => (prev > 0 ? prev : duration))
  }, [])

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      videoRef.current?.pause()
      setIsPlaying(false)
    } else {
      videoRef.current?.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleSeek = useCallback((absoluteSeconds: number) => {
    videoRef.current?.seekTo(absoluteSeconds)
    if (sourceDuration > 0) {
      setPlayheadPct(absoluteSeconds / sourceDuration)
    }
    // Select whichever clip contains this time
    setClips(prev => {
      const idx = prev.findIndex(
        c => absoluteSeconds >= c.start && absoluteSeconds <= c.start + c.duration,
      )
      if (idx !== -1) setSelectedIndex(idx)
      return prev
    })
  }, [sourceDuration])

  const handleTogglePanel = useCallback((panel: ActivePanel) => {
    setActivePanel(prev => (prev === panel ? null : panel))
  }, [])

  const handleResizeClip = useCallback((clipListIndex: number, newStart: number, newDuration: number) => {
    setClips(prev => prev.map((c, i) =>
      i === clipListIndex ? { ...c, start: newStart, duration: newDuration } : c,
    ))
  }, [])

  const handleAddResult = useCallback((result: SearchResult) => {
    console.log('[AddResult] called, result:', result)
    setAddedResultIds(prev => new Set([...prev, result.tempId]))
    const newIndex = nextClipIndex.current++
    setClips(prev => {
      const updated = insertClipNoOverlap(prev, result, newIndex)
      console.log('[AddResult] clips after insert:', updated.length, 'new clip index:', newIndex)
      const idx = updated.findIndex(c => c.index === newIndex)
      if (idx !== -1) setSelectedIndex(idx)
      return updated
    })
  }, [])

  // ── Insights handlers ───────────────────────────────────────────────────────

  const handleInsightUpload = useCallback(async (files: FileList) => {
    const names = Array.from(files).map(f => f.name)
    setUploadingFiles(names)
    setInsightsLoading(true)
    try {
      const uploaded = await Promise.all(Array.from(files).map(f => uploadFile(f)))
      const docPaths = uploaded.map(u => u.filePath)
      setDocumentPaths(prev => [...prev, ...docPaths])
      const { insights: raw } = await extractInsightsApi(docPaths)
      const cards: InsightCard[] = raw.map(r => ({
        ...mapRawInsight(r),
        added: false,
        addedToClipIndex: null,
      }))
      setInsights(prev => [...prev, ...cards])
    } catch (err) {
      console.error('[EditorPage] insight upload failed:', err)
    } finally {
      setInsightsLoading(false)
      setUploadingFiles([])
    }
  }, [])

  const handleAddInsightToScene = useCallback((id: string) => {
    setInsights(prev => prev.map(ins =>
      ins.id === id ? { ...ins, added: true, addedToClipIndex: selectedIndex } : ins,
    ))
  }, [selectedIndex])

  const handleRemoveInsightFromScene = useCallback((id: string) => {
    setInsights(prev => prev.map(ins =>
      ins.id === id ? { ...ins, added: false, addedToClipIndex: null } : ins,
    ))
  }, [])

  // ── Narration handlers ──────────────────────────────────────────────────────

  const handleGenerateNarration = useCallback(async () => {
    setNarrationLoading(true)
    try {
      const selectedClips = clips.filter(c => c.selected)
      const selectedClipIndices = selectedClips.map(c => c.index)

      const clipInsights: Record<string, string[]> = {}
      insights
        .filter(ins => ins.added && ins.addedToClipIndex !== null)
        .forEach(ins => {
          const clip = clips[ins.addedToClipIndex!]
          if (!clip) return
          const key = String(clip.index)
          clipInsights[key] = [...(clipInsights[key] ?? []), ins.title + (ins.description ? '. ' + ins.description : '')]
        })

      const clipBoundaries: Record<string, { start: number; end: number }> = {}
      selectedClips.forEach(c => {
        clipBoundaries[String(c.index)] = { start: c.start, end: c.start + c.duration }
      })

      const { scripts } = await generateNarrationScriptApi(
        jobId,
        selectedClipIndices,
        Object.keys(clipInsights).length ? clipInsights : undefined,
        clipBoundaries,
      )
      // Replace server-side sceneLabel (detection order) with the current
      // timeline position label so the narration panel shows the correct scene.
      const labeledScripts = scripts.map(s => {
        const clip = clips.find(c => c.index === s.clipIndex)
        return clip ? { ...s, sceneLabel: clip.sceneLabel } : s
      })
      setNarrationScripts(labeledScripts)
    } catch (err) {
      console.error('[EditorPage] narration script failed:', err)
    } finally {
      setNarrationLoading(false)
    }
  }, [jobId, clips, insights])

  const handleUpdateNarrationScript = useCallback((clipIndex: number, text: string) => {
    setNarrationScripts(prev => prev.map(s =>
      s.clipIndex === clipIndex ? { ...s, script: text } : s,
    ))
  }, [])

  // ── Layout handlers ─────────────────────────────────────────────────────────

  const handleApplyLayout = useCallback((layout: LayoutStyle, scope: 'all' | 'current', clipIndex: number) => {
    if (scope === 'all') {
      setGlobalLayout(layout)
      setClips(prev => prev.map(c => ({ ...c, layoutStyle: undefined })))
    } else {
      setClips(prev => prev.map((c, i) =>
        i === clipIndex ? { ...c, layoutStyle: layout } : c,
      ))
    }
  }, [])

  // ── Podcast handlers ────────────────────────────────────────────────────────

  const handleGeneratePodcastScript = useCallback(async () => {
    setPodcastLoading(true)
    setPodcastError(null)
    try {
      const { script } = await generatePodcastScriptApi(jobId, documentPaths.length ? documentPaths : undefined)
      setPodcastScript(script)
    } catch (err) {
      console.error('[EditorPage] podcast script failed:', err)
      setPodcastError((err as Error).message)
    } finally {
      setPodcastLoading(false)
    }
  }, [jobId, documentPaths])

  const handleRenderPodcast = useCallback(async () => {
    if (!podcastScript.trim()) return
    setPodcastRendering(true)
    setPodcastDownloadUrl(null)
    setPodcastError(null)
    try {
      const { podcastUrl } = await renderPodcastApi(jobId, podcastScript, podcastVoice)
      setPodcastDownloadUrl(podcastUrl)
    } catch (err) {
      console.error('[EditorPage] podcast render failed:', err)
      setPodcastError((err as Error).message)
    } finally {
      setPodcastRendering(false)
    }
  }, [jobId, podcastScript, podcastVoice])

  // ── Clip selection + brief assembly ─────────────────────────────────────────

  const [assembleJobId, setAssembleJobId] = useState<string | null>(null)
  const [isAssembling, setIsAssembling] = useState(false)
  const [briefUrl, setBriefUrl] = useState<string | null>(null)

  const handleToggleClipSelected = useCallback((clipListIndex: number) => {
    setClips(prev => prev.map((c, i) =>
      i === clipListIndex ? { ...c, selected: !c.selected } : c,
    ))
  }, [])

  const handleGenerateBrief = useCallback(async () => {
    const selectedClips = clips.filter(c => c.selected)
    if (!selectedClips.length) return
    setIsAssembling(true)
    setBriefUrl(null)
    try {
      // Clip boundaries
      const clipBoundaries: Record<string, { start: number; end: number }> = {}
      selectedClips.forEach(c => {
        clipBoundaries[String(c.index)] = { start: c.start, end: c.start + c.duration }
      })

      // Insights linked to each clip
      const clipInsights: Record<string, string[]> = {}
      insights
        .filter(ins => ins.added && ins.addedToClipIndex !== null)
        .forEach(ins => {
          const clip = clips[ins.addedToClipIndex!]
          if (!clip) return
          const key = String(clip.index)
          clipInsights[key] = [...(clipInsights[key] ?? []), ins.title + (ins.description ? '. ' + ins.description : '')]
        })

      // Per-clip layout overrides (only where the clip has an explicit override)
      const clipLayouts: Record<string, string> = {}
      selectedClips.forEach(c => {
        if (c.layoutStyle) clipLayouts[String(c.index)] = c.layoutStyle
      })

      // If the user generated (and possibly edited) narration scripts in the
      // Narration Panel, pass them so assembly skips GPT-4o re-generation.
      const builtNarrationScripts: Record<string, string> = {}
      narrationScripts.forEach((s: SceneScript) => {
        builtNarrationScripts[String(s.clipIndex)] = s.script
      })

      const { jobId: aJobId } = await startAssembly(jobId, {
        selectedIndices: selectedClips.map(c => c.index),
        clipBoundaries,
        clipInsights: Object.keys(clipInsights).length ? clipInsights : undefined,
        generateNarration: narrationUnlocked,
        generatePodcast: false,
        narrationVoice,
        globalLayout,
        clipLayouts: Object.keys(clipLayouts).length ? clipLayouts : undefined,
        narrationScripts: narrationUnlocked && Object.keys(builtNarrationScripts).length ? builtNarrationScripts : undefined,
        backgroundTrackId: selectedTrackId ?? undefined,
      })
      setAssembleJobId(aJobId)
    } catch (err) {
      console.error('[EditorPage] assemble failed:', err)
      setIsAssembling(false)
    }
  }, [clips, jobId, insights, narrationUnlocked, narrationVoice, globalLayout, narrationScripts])

  useJobPoller(
    assembleJobId,
    useCallback((job: JobResponse) => {
      if (job.status === 'complete') {
        setBriefUrl(`/api/output/${job.id}/brief.mp4`)
        setIsAssembling(false)
      } else if (job.status === 'error') {
        setIsAssembling(false)
      }
    }, []),
  )

  // Keyboard clip navigation: [ = prev, ] = next
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '[') { const idx = clips.map((_, i) => i).filter(i => clips[i].selected && i < selectedIndex).at(-1); if (idx != null) handleSelectClip(idx) }
      else if (e.key === ']') { const idx = clips.findIndex((c, i) => i > selectedIndex && c.selected); if (idx !== -1) handleSelectClip(idx) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIndex, clips.length, handleSelectClip])

  const selectedCount = clips.filter(c => c.selected).length

  // Navigation should only visit clips that are active (selected === true)
  const activeClipIndices = clips.map((_, i) => i).filter(i => clips[i].selected)
  const prevActiveIdx = activeClipIndices.filter(i => i < selectedIndex).at(-1) ?? null
  const nextActiveIdx = activeClipIndices.find(i => i > selectedIndex) ?? null

  const duration = selectedClip?.duration ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <EditorTopNav onShare={() => setShowShareModal(true)} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Video section */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#111' }}>
          <VideoPlayer
            ref={videoRef}
            jobId={jobId}
            clip={selectedClip}
            sourceUrl={sourceVideoUrl}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
          />

          {/* Timeline controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 44,
              borderTop: '1px solid #2a2a2a',
              background: '#fff',
              padding: '0 12px',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <button
              onClick={handleTogglePlay}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#e85d26',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="10" height="12" viewBox="0 0 10 12" fill="#fff">
                  <rect x="0" y="0" width="3.5" height="12" rx="1" />
                  <rect x="6.5" y="0" width="3.5" height="12" rx="1" />
                </svg>
              ) : (
                <svg width="10" height="12" viewBox="0 0 10 12" fill="#fff">
                  <path d="M1 0L10 6L1 12V0Z" />
                </svg>
              )}
            </button>

            <span style={{ fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(Math.max(0, selectedClip ? selectedClip.start + videoCurrentTime : videoCurrentTime))} / {formatTime(sourceDuration)}
            </span>

            {/* Clip navigation */}
            {clips.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                <button
                  onClick={() => { if (prevActiveIdx !== null) handleSelectClip(prevActiveIdx) }}
                  disabled={prevActiveIdx === null}
                  title="Previous clip (←)"
                  style={{
                    background: 'none',
                    border: '1px solid #e0e0e0',
                    borderRadius: 5,
                    cursor: prevActiveIdx === null ? 'default' : 'pointer',
                    opacity: prevActiveIdx === null ? 0.35 : 1,
                    padding: '3px 6px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M7.5 2L3.5 6L7.5 10" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span style={{ fontSize: 12, color: '#666', fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'center' }}>
                  {activeClipIndices.indexOf(selectedIndex) + 1} / {activeClipIndices.length}
                </span>
                <button
                  onClick={() => { if (nextActiveIdx !== null) handleSelectClip(nextActiveIdx) }}
                  disabled={nextActiveIdx === null}
                  title="Next clip (→)"
                  style={{
                    background: 'none',
                    border: '1px solid #e0e0e0',
                    borderRadius: 5,
                    cursor: nextActiveIdx === null ? 'default' : 'pointer',
                    opacity: nextActiveIdx === null ? 0.35 : 1,
                    padding: '3px 6px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M4.5 2L8.5 6L4.5 10" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}

            <div style={{ flex: 1 }} />

            <button
              onClick={() => setTimelineVisible(v => !v)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                color: '#888',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                style={{ transform: timelineVisible ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
              >
                <path d="M2 4L6 8L10 4" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {timelineVisible ? 'Hide timeline' : 'Show timeline'}
            </button>
          </div>

          {timelineVisible && (
            <SourceTimeline
              clips={clips}
              sourceDuration={sourceDuration}
              selectedIndex={selectedIndex}
              playheadPct={playheadPct}
              sourceVideoUrl={sourceVideoUrl}
              onSelectClip={handleSelectClip}
              onResizeClip={handleResizeClip}
              onSeek={handleSeek}
              onToggleClipSelected={handleToggleClipSelected}
            />
          )}

          {/* Generate Brief bar */}
          {clips.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 48,
                background: '#fafafa',
                borderTop: '1px solid #e8e8e8',
                padding: '0 16px',
                gap: 12,
                flexShrink: 0,
              }}
            >
              {/* Selection counter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: selectedCount > 0 ? '#e85d26' : '#ccc',
                    flexShrink: 0,
                    transition: 'background 0.2s',
                  }}
                />
                <span style={{ fontSize: 13, color: '#555' }}>
                  {selectedCount} of {clips.length} clip{clips.length !== 1 ? 's' : ''} selected
                </span>
              </div>

              <div style={{ flex: 1 }} />

              {/* Brief ready state */}
              {briefUrl && !isAssembling && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, animation: 'fadeIn 0.25s ease' }}>
                  <span style={{ fontSize: 13, color: '#28a745', fontWeight: 600 }}>
                    Brief ready
                  </span>
                  <a
                    href={briefUrl}
                    download="brief.mp4"
                    style={{
                      padding: '6px 14px',
                      background: '#fff',
                      border: '1px solid #e0e0e0',
                      borderRadius: 7,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#333',
                      cursor: 'pointer',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M12 3v13M5 14l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Download
                  </a>
                </div>
              )}

              {/* Generate Brief button */}
              <button
                onClick={handleGenerateBrief}
                disabled={selectedCount === 0 || isAssembling}
                style={{
                  padding: '7px 16px',
                  background: selectedCount > 0 && !isAssembling ? '#e85d26' : '#e0e0e0',
                  color: selectedCount > 0 && !isAssembling ? '#fff' : '#aaa',
                  border: 'none',
                  borderRadius: 7,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: selectedCount > 0 && !isAssembling ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'background 0.15s',
                  fontFamily: 'inherit',
                }}
              >
                {isAssembling ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="40 20" />
                    </svg>
                    Assembling…
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
                    </svg>
                    Generate Brief
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Side panels — width transition handles smooth open and close */}
        <div style={{
          width: activePanel !== null ? 360 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.18s ease',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {activePanel === 'find-clips' && (
            <FindClipsPanel
              jobId={jobId}
              sourceVideoUrl={sourceVideoUrl}
              onClose={() => setActivePanel(null)}
              onAddResult={handleAddResult}
              addedIds={addedResultIds}
            />
          )}
          {activePanel === 'insights' && (
            <InsightsPanel
              insights={insights}
              loading={insightsLoading}
              uploadingFiles={uploadingFiles}
              onClose={() => setActivePanel(null)}
              onUpload={handleInsightUpload}
              onAddToScene={handleAddInsightToScene}
              onRemoveFromScene={handleRemoveInsightFromScene}
            />
          )}
          {activePanel === 'narration' && (
            <NarrationPanel
              clips={clips}
              scripts={narrationScripts}
              loading={narrationLoading}
              voice={narrationVoice}
              isLocked={!narrationUnlocked}
              onClose={() => setActivePanel(null)}
              onUnlock={() => { handleUnlockNarration(); handleGenerateNarration() }}
              onGenerateScript={handleGenerateNarration}
              onUpdateScript={handleUpdateNarrationScript}
              onVoiceChange={setNarrationVoice}
              onAddNarration={handleGenerateNarration}
            />
          )}
          {activePanel === 'podcast' && (
            <PodcastPanel
              clips={clips}
              script={podcastScript}
              loading={podcastLoading}
              rendering={podcastRendering}
              downloadUrl={podcastDownloadUrl}
              voice={podcastVoice}
              error={podcastError}
              onClose={() => setActivePanel(null)}
              onGenerateScript={handleGeneratePodcastScript}
              onUpdateScript={setPodcastScript}
              onVoiceChange={setPodcastVoice}
              onGeneratePodcast={handleRenderPodcast}
            />
          )}
          {activePanel === 'layouts' && (
            <LayoutsPanel
              clips={clips}
              selectedClipIndex={selectedIndex}
              insights={insights}
              globalLayout={globalLayout}
              onClose={() => setActivePanel(null)}
              onApplyLayout={handleApplyLayout}
            />
          )}
          {activePanel === 'music' && (
            <MusicPanel
              selectedTrackId={selectedTrackId}
              onClose={() => setActivePanel(null)}
              onApplyTrack={setSelectedTrackId}
            />
          )}
        </div>

        {/* Sidebar */}
        <EditorSidebar activePanel={activePanel} onToggle={handleTogglePanel} narrationUnlocked={narrationUnlocked} />
      </div>

      {showShareModal && (
        <ShareModal jobId={jobId} clips={clips} onClose={() => setShowShareModal(false)} />
      )}
    </div>
  )
}
