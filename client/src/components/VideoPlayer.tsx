import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { EditorClip } from '../types'
import styles from './VideoPlayer.module.css'

export interface VideoPlayerHandle {
  play: () => void
  pause: () => void
  reset: () => void
  seekTo: (seconds: number) => void
}

interface Props {
  jobId: string
  clip: EditorClip | null
  /** Source video URL. When provided the player shows the full source video and
   *  seeks to clip.start / pauses at clip.start + clip.duration. */
  sourceUrl?: string | null
  onTimeUpdate: (time: number) => void
  onDurationChange?: (duration: number) => void
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  function VideoPlayer({ jobId, clip, sourceUrl, onTimeUpdate, onDurationChange }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const clipRef = useRef(clip)
    const sourceUrlRef = useRef(sourceUrl)
    clipRef.current = clip
    sourceUrlRef.current = sourceUrl

    useImperativeHandle(ref, () => ({
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      reset: () => {
        const video = videoRef.current
        if (!video) return
        video.pause()
        video.currentTime = sourceUrlRef.current && clipRef.current ? clipRef.current.start : 0
      },
      seekTo: (seconds: number) => {
        const video = videoRef.current
        if (!video) return
        video.currentTime = seconds
      },
    }))

    // Seek to the new clip's start whenever the selected clip changes.
    // Runs after React re-renders so clipRef.current is already the new clip.
    useEffect(() => {
      const video = videoRef.current
      if (!video || !sourceUrl || clip == null) return
      video.currentTime = clip.start
    }, [clip?.index]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleLoadedMetadata = () => {
      const video = videoRef.current
      if (!video) return
      if (onDurationChange && video.duration && isFinite(video.duration)) {
        onDurationChange(video.duration)
      }
    }

    const handleTimeUpdate = () => {
      const video = videoRef.current
      if (!video) return
      const absTime = video.currentTime
      if (sourceUrl && clipRef.current) {
        if (absTime >= clipRef.current.start + clipRef.current.duration) {
          video.pause()
        }
        onTimeUpdate(absTime - clipRef.current.start)
      } else {
        onTimeUpdate(absTime)
      }
    }

    const handleError = () => {
      const video = videoRef.current
      if (video?.error) {
        console.error('[VideoPlayer] load error', video.error.code, video.error.message)
      }
    }

    const src = sourceUrl ?? (clip != null ? `/api/output/${jobId}/clips/${clip.index}` : null)

    return (
      <div className={styles.wrapper}>
        {src ? (
          <>
            <video
              ref={videoRef}
              className={styles.video}
              src={src}
              muted={false}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onError={handleError}
              preload="metadata"
            />
            {clip && <div className={styles.badge}>{clip.sceneLabel}</div>}
          </>
        ) : (
          <div className={styles.placeholder}>No clip selected</div>
        )}
        <div className={styles.hint}>Click scenes in the timeline below to navigate</div>
      </div>
    )
  },
)
