import { useState, useRef, useCallback } from 'react'
import type { SearchResult } from '../types'
import { searchClipsApi } from '../api'
import styles from './FindClipsPanel.module.css'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface Props {
  jobId: string
  sourceVideoUrl?: string | null
  onClose: () => void
  onAddResult: (result: SearchResult) => void
  addedIds: Set<string>
}

export function FindClipsPanel({ jobId, sourceVideoUrl, onClose, onAddResult, addedIds }: Props) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q || isSearching) return
    setIsSearching(true)
    try {
      const { results: newResults } = await searchClipsApi(jobId, q)
      setResults(newResults)
    } catch (err) {
      console.error('[FindClipsPanel] search failed:', err)
    } finally {
      setIsSearching(false)
      setQuery('')
    }
  }, [jobId, query, isSearching])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSearch()
      }
    },
    [handleSearch],
  )

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2 L13.2 10.8 L22 12 L13.2 13.2 L12 22 L10.8 13.2 L2 12 L10.8 10.8 Z"
              stroke="#e85d26"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          Find Clips
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className={styles.instructionCard}>
        Search for new moments in your video. Results will appear below — hover to preview, click + to add
        to your timeline.
      </div>

      <div className={styles.results}>
        {results.length === 0 && !isSearching && (
          <p className={styles.emptyHint}>Search results will appear here</p>
        )}
        {isSearching && <p className={styles.emptyHint}>Searching…</p>}
        {results.map(r => (
          <ResultCard
            key={r.tempId}
            result={r}
            sourceVideoUrl={sourceVideoUrl ?? `/api/output/${jobId}/source`}
            added={addedIds.has(r.tempId)}
            onAdd={() => onAddResult(r)}
          />
        ))}
      </div>

      <div className={styles.searchBar}>
        <textarea
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Search for more moments..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isSearching}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSearch}
          disabled={!query.trim() || isSearching}
          aria-label="Search"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Result Card ─────────────────────────────────────────────────────────────

function ResultCard({
  result,
  sourceVideoUrl,
  added,
  onAdd,
}: {
  result: SearchResult
  sourceVideoUrl: string
  added: boolean
  onAdd: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const end = result.start + result.duration

  const handleMouseEnter = () => {
    const video = videoRef.current
    if (!video) return
    video.style.display = 'block'
    video.currentTime = result.start
    video.play().catch(() => {})
  }

  const handleMouseLeave = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.style.display = 'none'
  }

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return
    if (video.currentTime >= end) {
      video.pause()
      video.style.display = 'none'
    }
  }

  return (
    <div className={styles.resultCard}>
      <div
        className={styles.thumbnail}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {result.thumbnailUrl ? (
          <img src={result.thumbnailUrl} alt="" className={styles.thumbnailImg} />
        ) : (
          <div className={styles.thumbnailPlaceholder} />
        )}
        <video
          ref={videoRef}
          src={sourceVideoUrl}
          className={styles.thumbnailVideo}
          onTimeUpdate={handleVideoTimeUpdate}
          muted
          playsInline
        />
      </div>
      <button
        className={`${styles.addBtn} ${added ? styles.added : ''}`}
        onClick={onAdd}
        disabled={added}
        aria-label={added ? 'Added' : 'Add to timeline'}
      >
        {added ? '✓' : '+'}
      </button>
      <div className={styles.cardMeta}>
        <span className={styles.timeRange}>
          {formatTime(result.start)} – {formatTime(end)}
        </span>
        <span className={`${styles.confidence} ${styles[result.confidence as 'high' | 'medium' | 'low']}`}>
          {result.confidence}
        </span>
      </div>
    </div>
  )
}
