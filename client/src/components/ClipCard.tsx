import type { EditorClip } from '../types'
import styles from './ClipCard.module.css'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0
    ? `${m}:${String(s).padStart(2, '0')}`
    : `0:${String(s).padStart(2, '0')}`
}

interface Props {
  clip: EditorClip
  isActive: boolean
  onSelect: () => void
  onToggleSelected: () => void
}

export function ClipCard({ clip, isActive, onSelect, onToggleSelected }: Props) {
  const confidenceClass =
    clip.confidence === 'high'
      ? styles.confidenceHigh
      : clip.confidence === 'medium'
        ? styles.confidenceMed
        : styles.confidenceLow

  return (
    <div
      className={`${styles.card} ${isActive ? styles.active : ''} ${!clip.selected ? styles.deselected : ''}`}
      onClick={onSelect}
      title={clip.sceneLabel}
    >
      {/* Thumbnail */}
      <div className={styles.thumb}>
        {clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} alt={clip.sceneLabel} draggable={false} />
        ) : (
          <div className={styles.thumbPlaceholder} />
        )}
      </div>

      {/* Deselected overlay */}
      {!clip.selected && <div className={styles.deselectedOverlay} />}

      {/* Scene label */}
      <div className={styles.label}>{clip.sceneLabel}</div>

      {/* Bottom row: duration + confidence */}
      <div className={styles.meta}>
        <span className={styles.duration}>{formatDuration(clip.duration)}</span>
        {(clip.confidence === 'high' || clip.confidence === 'medium' || clip.confidence === 'low') && (
          <span className={`${styles.confidence} ${confidenceClass}`}>{clip.confidence}</span>
        )}
      </div>

      {/* Include/exclude toggle */}
      <button
        className={`${styles.toggle} ${clip.selected ? styles.toggleOn : styles.toggleOff}`}
        onClick={e => { e.stopPropagation(); onToggleSelected() }}
        title={clip.selected ? 'Remove from brief' : 'Add to brief'}
        aria-label={clip.selected ? 'Remove from brief' : 'Add to brief'}
      >
        {clip.selected ? (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 4.5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  )
}
