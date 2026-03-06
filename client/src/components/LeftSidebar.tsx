import { useRef, useCallback } from 'react'
import type { UploadedVideo, IndexedVideo } from '../types'
import styles from './LeftSidebar.module.css'

interface Props {
  projectName: string
  videos: UploadedVideo[]
  uploadProgress: number
  onUpload: (file: File) => void
  onToggleVideo: (fileId: string) => void
  indexedVideos?: IndexedVideo[]
  onToggleIndexedVideo?: (fileId: string) => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function LeftSidebar({ projectName, videos, uploadProgress, onUpload, onToggleVideo, indexedVideos, onToggleIndexedVideo }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file && file.type.startsWith('video/')) onUpload(file)
    },
    [onUpload],
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onUpload(file)
      e.target.value = ''
    },
    [onUpload],
  )

  return (
    <aside className={styles.sidebar}>
      <div className={styles.projectHeader}>
        <h2 className={styles.projectName}>{projectName}</h2>
        <span className={styles.videoCount}>
          {videos.length} video{videos.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Upload dropzone */}
      <div
        className={styles.uploadZone}
        onClick={() => !uploadProgress && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/*"
          hidden
          onChange={handleFileChange}
        />
        {uploadProgress > 0 ? (
          <div className={styles.uploadingState}>
            <span className={styles.uploadingText}>Uploading… {uploadProgress}%</span>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : (
          <>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload video</span>
          </>
        )}
      </div>
      <p className={styles.uploadHint}>MP4, MOV • Max 500MB</p>

      {/* Videos section */}
      <p className={styles.sectionLabel}>VIDEOS</p>
      {videos.length === 0 ? (
        <p className={styles.emptyState}>Uploaded videos will show up here</p>
      ) : (
        <div className={styles.videoGrid}>
          {videos.map(video => (
            <div key={video.fileId} className={styles.videoCard}>
              {/* Thumbnail */}
              <div className={styles.thumbnail}>
                {video.previewUrl && (
                  <video
                    className={styles.thumbVideo}
                    src={video.previewUrl}
                    muted
                    preload="metadata"
                    onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 1 }}
                  />
                )}
              </div>

              {/* Checkbox */}
              <button
                className={`${styles.checkbox} ${video.selected ? styles.checked : ''}`}
                onClick={() => onToggleVideo(video.fileId)}
                aria-label={video.selected ? 'Deselect video' : 'Select video'}
              >
                {video.selected && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <polyline
                      points="2 6 5 9 10 3"
                      stroke="#fff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>

              {/* Info overlay */}
              <div className={styles.videoInfo}>
                <span className={styles.videoName}>{video.originalName}</span>
                {video.duration != null && (
                  <span className={styles.videoDuration}>{formatDuration(video.duration)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Previously indexed videos */}
      {indexedVideos && indexedVideos.length > 0 && (
        <>
          <hr className={styles.sectionDivider} />
          <p className={styles.sectionLabel}>PREVIOUSLY INDEXED</p>
          <div className={styles.videoGrid}>
            {indexedVideos.map(video => (
              <div key={video.fileId} className={styles.videoCard}>
                <div className={styles.thumbnail}>
                  {video.thumbnailUrl && (
                    <video
                      className={styles.thumbVideo}
                      src={video.thumbnailUrl}
                      muted
                      preload="metadata"
                      onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 1 }}
                    />
                  )}
                </div>
                <span className={styles.indexedBadge}>Indexed</span>

                <button
                  className={`${styles.checkbox} ${video.selected ? styles.checked : ''}`}
                  onClick={() => onToggleIndexedVideo?.(video.fileId)}
                  aria-label={video.selected ? 'Deselect video' : 'Select video'}
                >
                  {video.selected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <polyline
                        points="2 6 5 9 10 3"
                        stroke="#fff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>

                <div className={styles.videoInfo}>
                  <span className={styles.videoName}>{video.originalName}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
