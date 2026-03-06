import { useRef, useCallback, useEffect, useState } from 'react'
import type { EditorClip } from '../types'
import styles from './SourceTimeline.module.css'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// leftWall  — earliest position the left edge can reach (used by 'left' and 'move')
// rightWall — for 'right': latest the right edge can reach; for 'move': latest start position
interface DragState {
  type: 'left' | 'right' | 'move'
  clipListIndex: number
  startX: number
  originalStart: number
  originalDuration: number
  trackWidth: number
  leftWall: number
  rightWall: number
  windowDuration: number  // captured at drag start so window shifts don't corrupt mid-drag
}

const MIN_DURATION = 2
const FRAME_W = 48 // px — must match track height so frames are square
const ZOOM_RADIUS = 60 // seconds on each side of the selected clip's center

interface Props {
  clips: EditorClip[]
  sourceDuration: number
  selectedIndex: number
  playheadPct: number
  sourceVideoUrl?: string | null
  onSelectClip: (index: number) => void
  onResizeClip: (clipListIndex: number, newStart: number, newDuration: number) => void
  onSeek: (absoluteSeconds: number) => void
  onToggleClipSelected: (clipListIndex: number) => void
}

// Compute collision walls for a clip being dragged.
// Only selected (visible) clips participate — deselected clips are gone from the timeline.
function computeWalls(
  clip: EditorClip,
  clips: EditorClip[],
  sourceDuration: number,
): { leftWall: number; rightWall: number } {
  let leftWall = 0
  let rightWall = sourceDuration

  for (const c of clips) {
    if (c.index === clip.index || !c.selected) continue
    const cEnd = c.start + c.duration
    if (cEnd <= clip.start) {
      leftWall = Math.max(leftWall, cEnd)
    } else if (c.start >= clip.start + clip.duration) {
      rightWall = Math.min(rightWall, c.start)
    }
  }

  return { leftWall, rightWall }
}

export function SourceTimeline({
  clips,
  sourceDuration,
  selectedIndex,
  playheadPct,
  sourceVideoUrl,
  onSelectClip,
  onResizeClip,
  onSeek,
  onToggleClipSelected,
}: Props) {
  const overviewRef = useRef<HTMLDivElement>(null)
  const zoomedRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const didDragRef = useRef(false)
  const sourceDurationRef = useRef(sourceDuration)
  const [trackFrames, setTrackFrames] = useState<string[]>([])
  const [isDraggingMove, setIsDraggingMove] = useState(false)

  useEffect(() => { sourceDurationRef.current = sourceDuration }, [sourceDuration])

  // ── Zoomed window: fixed ±ZOOM_RADIUS around the selected clip's center ─────
  const selectedClipData = clips[selectedIndex] ?? null
  const zoomCenter = selectedClipData
    ? selectedClipData.start + selectedClipData.duration / 2
    : sourceDuration / 2
  const windowStart = Math.max(0, zoomCenter - ZOOM_RADIUS)
  const windowEnd = Math.min(sourceDuration, zoomCenter + ZOOM_RADIUS)
  const windowDuration = windowEnd - windowStart

  const toOverviewPct = (t: number) =>
    sourceDuration > 0 ? (t / sourceDuration) * 100 : 0

  const toZoomedPct = (t: number) =>
    windowDuration > 0 ? ((t - windowStart) / windowDuration) * 100 : 0

  // Zoomed playhead position (clamped, hidden when out of window)
  const absolutePlayhead = playheadPct * sourceDuration
  const zoomedPlayheadPct = windowDuration > 0
    ? ((absolutePlayhead - windowStart) / windowDuration) * 100
    : -1

  // ── Full-track filmstrip extraction (used in overview) ──────────────────────
  useEffect(() => {
    if (!sourceVideoUrl) return

    let cancelled = false

    const extract = async () => {
      const trackWidth = overviewRef.current?.getBoundingClientRect().width || 600
      const duration = sourceDurationRef.current
      if (duration <= 0) return

      const video = document.createElement('video')
      video.src = sourceVideoUrl
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.preload = 'metadata'

      await new Promise<void>((res, rej) => {
        video.addEventListener('loadedmetadata', () => res(), { once: true })
        video.addEventListener('error', () => rej(new Error('Video load failed')), { once: true })
        video.load()
      })

      if (cancelled || !video.duration || video.duration === Infinity) {
        video.src = ''
        return
      }

      const numFrames = Math.min(16, Math.max(1, Math.round(trackWidth / FRAME_W)))
      const canvas = document.createElement('canvas')
      canvas.width = FRAME_W
      canvas.height = FRAME_W
      const ctx = canvas.getContext('2d')!
      const frames: string[] = []

      for (let k = 0; k < numFrames; k++) {
        if (cancelled) break
        const t = (k + 0.5) * (video.duration / numFrames)
        video.currentTime = Math.min(t, video.duration - 0.05)
        await new Promise<void>(res => {
          video.addEventListener('seeked', () => res(), { once: true })
        })
        if (cancelled) break
        ctx.drawImage(video, 0, 0, FRAME_W, FRAME_W)
        frames.push(canvas.toDataURL('image/jpeg', 0.7))
        // Render each frame as it loads — don't wait for the full strip
        setTrackFrames([...frames])
      }
      video.src = ''
    }

    extract().catch(err => {
      if (!cancelled) console.warn('[Filmstrip] Frame extraction failed:', err)
    })

    return () => { cancelled = true }
  }, [sourceVideoUrl])

  // ── Drag handlers (all drag happens in the zoomed track) ────────────────────

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'left' | 'right', clipListIndex: number) => {
      e.stopPropagation()
      e.preventDefault()
      const track = zoomedRef.current
      if (!track) return
      const clip = clips[clipListIndex]
      const { leftWall, rightWall } = computeWalls(clip, clips, sourceDuration)

      dragRef.current = {
        type,
        clipListIndex,
        startX: e.clientX,
        originalStart: clip.start,
        originalDuration: clip.duration,
        trackWidth: track.getBoundingClientRect().width,
        leftWall,
        rightWall,
        windowDuration,
      }
      didDragRef.current = false
    },
    [clips, sourceDuration, windowDuration],
  )

  const handleSegmentMouseDown = useCallback(
    (e: React.MouseEvent, clipListIndex: number) => {
      e.stopPropagation()
      e.preventDefault()
      const track = zoomedRef.current
      if (!track) return
      const clip = clips[clipListIndex]
      const { leftWall, rightWall } = computeWalls(clip, clips, sourceDuration)

      dragRef.current = {
        type: 'move',
        clipListIndex,
        startX: e.clientX,
        originalStart: clip.start,
        originalDuration: clip.duration,
        trackWidth: track.getBoundingClientRect().width,
        leftWall,
        // for 'move', rightWall from computeWalls is the nearest clip start to the right;
        // subtract clip width to get the max allowed start position
        rightWall: Math.min(rightWall - clip.duration, sourceDuration - clip.duration),
        windowDuration,
      }
      didDragRef.current = false
      setIsDraggingMove(true)
    },
    [clips, sourceDuration, windowDuration],
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const deltaX = e.clientX - drag.startX
      if (Math.abs(deltaX) > 2) didDragRef.current = true
      // Use the window duration captured at drag-start — not sourceDuration
      const deltaSeconds = (deltaX / drag.trackWidth) * drag.windowDuration

      if (drag.type === 'move') {
        const newStart = Math.max(drag.leftWall, Math.min(drag.rightWall, drag.originalStart + deltaSeconds))
        onResizeClip(drag.clipListIndex, newStart, drag.originalDuration)
      } else if (drag.type === 'left') {
        const fixedEnd = drag.originalStart + drag.originalDuration
        const newStart = Math.max(
          drag.leftWall,
          Math.min(fixedEnd - MIN_DURATION, drag.originalStart + deltaSeconds),
        )
        onResizeClip(drag.clipListIndex, newStart, fixedEnd - newStart)
      } else {
        const newDuration = Math.max(
          MIN_DURATION,
          Math.min(drag.rightWall - drag.originalStart, drag.originalDuration + deltaSeconds),
        )
        onResizeClip(drag.clipListIndex, drag.originalStart, newDuration)
      }
    }

    const onMouseUp = () => {
      if (dragRef.current?.type === 'move') setIsDraggingMove(false)
      dragRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [onResizeClip])

  const handleOverviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!overviewRef.current || sourceDuration <= 0) return
      const rect = overviewRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      onSeek(pct * sourceDuration)
    },
    [sourceDuration, onSeek],
  )

  const hasFilmstrip = trackFrames.length > 0

  return (
    <div className={styles.container}>

      {/* ── Overview ─────────────────────────────────────────────────────────── */}
      <div className={styles.trackLabel}>Overview</div>
      <div
        ref={overviewRef}
        className={styles.overviewTrack}
        onClick={handleOverviewClick}
        title="Click to seek"
      >
        {hasFilmstrip && (
          <div className={styles.trackFilmstrip}>
            {trackFrames.map((src, i) => (
              <img key={i} className={styles.filmstripFrame} src={src} alt="" draggable={false} />
            ))}
          </div>
        )}

        {/* All clips (non-interactive marks) */}
        {clips.map((clip, i) => {
          if (!clip.selected) return null
          const left = toOverviewPct(clip.start)
          const width = Math.max(0.5, toOverviewPct(clip.start + clip.duration) - left)
          const isActive = i === selectedIndex
          return (
            <div
              key={clip.index}
              className={`${styles.overviewSegment} ${isActive ? styles.overviewSegmentActive : ''}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              onClick={e => { e.stopPropagation(); onSelectClip(i) }}
            />
          )
        })}

        {/* Zoomed window bracket */}
        <div
          className={styles.windowBracket}
          style={{
            left: `${toOverviewPct(windowStart)}%`,
            width: `${toOverviewPct(windowEnd) - toOverviewPct(windowStart)}%`,
          }}
        />

        {/* Playhead */}
        <div className={styles.overviewPlayhead} style={{ left: `${playheadPct * 100}%` }} />
      </div>
      <div className={styles.overviewTimestamps}>
        <span>0:00</span>
        <span>{sourceDuration > 0 ? formatTime(sourceDuration) : '--:--'}</span>
      </div>

      {/* ── Zoomed track ─────────────────────────────────────────────────────── */}
      <div className={styles.trackLabel}>
        Zoomed — {formatTime(windowStart)} → {formatTime(windowEnd)}
      </div>
      <div className={styles.zoomedWrapper}>
        <div
          ref={zoomedRef}
          className={`${styles.track} ${isDraggingMove ? styles.trackDragging : ''}`}

        >
          {clips.map((clip, i) => {
            if (!clip.selected) return null
            // Skip clips entirely outside the window
            if (clip.start + clip.duration < windowStart || clip.start > windowEnd) return null

            // Clamp visual bounds to window edges
            const rawLeft = toZoomedPct(clip.start)
            const rawRight = toZoomedPct(clip.start + clip.duration)
            const left = Math.max(0, rawLeft)
            const right = Math.min(100, rawRight)
            const width = Math.max(1.5, right - left)
            const isActive = i === selectedIndex
            // Only show a handle if it falls within the visible window
            const showLeftHandle = rawLeft >= -1
            const showRightHandle = rawRight <= 101

            const classes = [
              styles.segment,
              isActive ? styles.active : '',
            ].filter(Boolean).join(' ')

            return (
              <div
                key={clip.index}
                className={classes}
                style={{ left: `${left}%`, width: `${width}%` }}
                onMouseDown={e => handleSegmentMouseDown(e, i)}
                onClick={e => {
                  e.stopPropagation()
                  if (didDragRef.current) { didDragRef.current = false; return }
                  onSelectClip(i)
                }}
                title={clip.sceneLabel}
              >
                {showLeftHandle && (
                  <div className={styles.handleLeft} onMouseDown={e => handleHandleMouseDown(e, 'left', i)} />
                )}
                <span className={styles.segmentLabel}>{clip.sceneLabel}</span>
                <button
                  className={`${styles.selectToggle} ${styles.selectToggleOn}`}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onToggleClipSelected(i) }}
                  title="Remove from brief"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {showRightHandle && (
                  <div className={styles.handleRight} onMouseDown={e => handleHandleMouseDown(e, 'right', i)} />
                )}
              </div>
            )
          })}

          {zoomedPlayheadPct >= 0 && zoomedPlayheadPct <= 100 && (
            <div className={styles.playhead} style={{ left: `${zoomedPlayheadPct}%` }} />
          )}
        </div>
      </div>

      <div className={styles.timestamps}>
        <span>{formatTime(windowStart)}</span>
        <span>{formatTime(windowEnd)}</span>
      </div>
    </div>
  )
}
