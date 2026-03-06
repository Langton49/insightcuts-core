import { useRef, useCallback, useEffect } from 'react'
import type { EditorClip } from '../types'
import styles from './ClipScrubber.module.css'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const MIN_DURATION = 2

interface DragState {
  type: 'left' | 'right'
  startX: number
  originalStart: number
  originalDuration: number
  trackWidth: number
  leftWall: number
  rightWall: number
  sourceDuration: number
}

interface Props {
  clip: EditorClip
  allClips: EditorClip[]
  playheadPct: number // 0-1 relative to clip's sourceDuration
  onResizeClip: (newStart: number, newDuration: number) => void
  onSeek: (absoluteSeconds: number) => void
}

/** Returns collision walls for the given clip among clips sharing the same sourceVideoUrl. */
function computeWalls(
  clip: EditorClip,
  allClips: EditorClip[],
  sourceDuration: number,
): { leftWall: number; rightWall: number } {
  let leftWall = 0
  let rightWall = sourceDuration

  for (const c of allClips) {
    if (c.index === clip.index || !c.selected) continue
    // Only consider clips from the same source video
    if (c.sourceVideoUrl !== clip.sourceVideoUrl) continue
    const cEnd = c.start + c.duration
    if (cEnd <= clip.start) {
      leftWall = Math.max(leftWall, cEnd)
    } else if (c.start >= clip.start + clip.duration) {
      rightWall = Math.min(rightWall, c.start)
    }
  }

  return { leftWall, rightWall }
}

export function ClipScrubber({ clip, allClips, playheadPct, onResizeClip, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  // Stable ref so the mousemove effect never needs to re-register during drag
  const onResizeClipRef = useRef(onResizeClip)
  onResizeClipRef.current = onResizeClip

  const sourceDuration = clip.sourceDuration ?? 0

  const toPct = (t: number) =>
    sourceDuration > 0 ? (t / sourceDuration) * 100 : 0

  const clipLeft = toPct(clip.start)
  const clipRight = toPct(clip.start + clip.duration)
  const clipWidth = Math.max(0.5, clipRight - clipLeft)

  // Playhead absolute position
  const playheadAbsolute = playheadPct * sourceDuration
  const playheadLeft = toPct(playheadAbsolute)
  const playheadVisible = playheadAbsolute >= clip.start && playheadAbsolute <= clip.start + clip.duration

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'left' | 'right') => {
      e.stopPropagation()
      e.preventDefault()
      const track = trackRef.current
      if (!track || sourceDuration <= 0) return
      const { leftWall, rightWall } = computeWalls(clip, allClips, sourceDuration)

      dragRef.current = {
        type,
        startX: e.clientX,
        originalStart: clip.start,
        originalDuration: clip.duration,
        trackWidth: track.getBoundingClientRect().width,
        leftWall,
        rightWall,
        sourceDuration,
      }
    },
    [clip, allClips, sourceDuration],
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const deltaX = e.clientX - drag.startX
      const deltaSeconds = (deltaX / drag.trackWidth) * drag.sourceDuration

      if (drag.type === 'left') {
        const fixedEnd = drag.originalStart + drag.originalDuration
        const newStart = Math.max(
          drag.leftWall,
          Math.min(fixedEnd - MIN_DURATION, drag.originalStart + deltaSeconds),
        )
        onResizeClipRef.current(newStart, fixedEnd - newStart)
      } else {
        const newDuration = Math.max(
          MIN_DURATION,
          Math.min(drag.rightWall - drag.originalStart, drag.originalDuration + deltaSeconds),
        )
        onResizeClipRef.current(drag.originalStart, newDuration)
      }
    }

    const onMouseUp = () => {
      dragRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, []) // empty deps — onResizeClipRef.current is always current without re-registering

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current || sourceDuration <= 0) return
      const rect = trackRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      onSeek(pct * sourceDuration)
    },
    [sourceDuration, onSeek],
  )

  if (sourceDuration <= 0) return null

  return (
    <div className={styles.container}>
      <div className={styles.trackRow}>
        <span className={styles.timeLabel}>{formatTime(clip.start)}</span>

        <div
          ref={trackRef}
          className={styles.track}
          onClick={handleTrackClick}
          title="Click to seek"
        >
          {/* Pre-clip shaded region */}
          <div className={styles.preRegion} style={{ width: `${clipLeft}%` }} />

          {/* Clip segment */}
          <div
            className={styles.segment}
            style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
          >
            <div
              className={styles.handleLeft}
              onMouseDown={e => handleHandleMouseDown(e, 'left')}
              title="Drag to extend start"
            />
            <div className={styles.segmentFill} />
            <div
              className={styles.handleRight}
              onMouseDown={e => handleHandleMouseDown(e, 'right')}
              title="Drag to extend end"
            />
          </div>

          {/* Post-clip shaded region */}
          <div className={styles.postRegion} style={{ left: `${clipRight}%`, width: `${100 - clipRight}%` }} />

          {/* Playhead */}
          {playheadVisible && (
            <div className={styles.playhead} style={{ left: `${playheadLeft}%` }} />
          )}
        </div>

        <span className={styles.timeLabel}>{formatTime(clip.start + clip.duration)}</span>
      </div>

      {/* Source video total duration indicator */}
      <div className={styles.totalDuration}>
        source: {formatTime(sourceDuration)}
      </div>
    </div>
  )
}
