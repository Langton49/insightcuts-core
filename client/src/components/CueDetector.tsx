import type { DetectionPattern, JobState } from '../types'
import styles from './CueDetector.module.css'

interface Props {
  jobState: JobState
  query: string
  onQueryChange: (q: string) => void
  onQuery: (query: string) => void
  onTogglePattern: (patternId: string) => void
}

export function CueDetector({ jobState, query, onQueryChange, onQuery, onTogglePattern }: Props) {
  const isDetecting = jobState.status === 'detecting'
  const hasPatterns = jobState.patterns.length > 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    const q = query.trim()
    if (!q || isDetecting) return
    onQuery(q)
  }

  return (
    <div className={styles.container}>
      {/* Scrollable content area */}
      <div className={styles.content}>
        <div className={styles.titleRow}>
          {/* 4-pointed sparkle icon */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className={styles.sparkleIcon}
          >
            <path
              d="M12 2 L13.2 10.8 L22 12 L13.2 13.2 L12 22 L10.8 13.2 L2 12 L10.8 10.8 Z"
              fill="#111"
            />
          </svg>
          <h1 className={styles.title}>CueDetector</h1>
        </div>

        {/* Idle / empty state */}
        {jobState.status === 'idle' && (
          <>
            <p className={styles.body}>
              Uploaded videos will be automatically analyzed and I will bring you common patterns I
              can find.
            </p>
            <p className={styles.body}>
              Describe what you're looking for (a gesture, a reaction, a specific signal) and I'll
              locate it across your clips. The more specific you are, the better the results.
            </p>
          </>
        )}

        {/* Detecting state */}
        {isDetecting && (
          <p className={styles.body}>Analyzing your videos, this may take a moment…</p>
        )}

        {/* Has results */}
        {hasPatterns && (
          <>
            <p className={styles.body}>
              Describe what you're looking for (a gesture, a reaction, a specific signal) and I'll
              locate it across your clips. The more specific you are, the better the results.
            </p>
            <p className={styles.body}>
              I analyzed your video and detected the following patterns. Want to explore one?
            </p>
            <div className={styles.chips}>
              {jobState.patterns.map(pattern => (
                <PatternChip
                  key={pattern.id}
                  pattern={pattern}
                  onToggle={() => onTogglePattern(pattern.id)}
                />
              ))}
            </div>
          </>
        )}

        {/* Error state */}
        {jobState.status === 'error' && (
          <p className={styles.errorText}>
            Detection failed{jobState.error ? `: ${jobState.error}` : ''}. Try again.
          </p>
        )}
      </div>

      {/* Fixed input area at bottom of panel */}
      <div className={styles.inputArea}>
        <textarea
          className={styles.textarea}
          placeholder="e.g woman holding a white paper, moments tagged"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDetecting}
          rows={3}
        />
      </div>
    </div>
  )
}

function PatternChip({
  pattern,
  onToggle,
}: {
  pattern: DetectionPattern
  onToggle: () => void
}) {
  return (
    <button
      className={`${styles.chip} ${pattern.selected ? styles.chipSelected : ''}`}
      onClick={onToggle}
    >
      {pattern.label}
    </button>
  )
}
