import { useRef, useState, useCallback } from 'react'
import type { InsightCard } from '../types'
import styles from './InsightsPanel.module.css'

interface Props {
  insights: InsightCard[]
  loading: boolean
  uploadingFiles: string[]
  onClose: () => void
  onUpload: (files: FileList) => void
  onAddToScene: (id: string) => void
  onRemoveFromScene: (id: string) => void
}

export function InsightsPanel({
  insights,
  loading,
  uploadingFiles,
  onClose,
  onUpload,
  onAddToScene,
  onRemoveFromScene,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)

  const triggerUpload = () => fileInputRef.current?.click()

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        onUpload(e.target.files)
        e.target.value = ''
      }
    },
    [onUpload],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragover(false)
      if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files)
    },
    [onUpload],
  )

  // Group insights by source file
  const groupedMap = new Map<string, InsightCard[]>()
  for (const ins of insights) {
    const group = groupedMap.get(ins.source) ?? []
    group.push(ins)
    groupedMap.set(ins.source, group)
  }
  const groups = Array.from(groupedMap.entries())

  return (
    <div className={styles.panel}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.doc,.txt,.csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="14" x2="15" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          Insights
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className={styles.loadingArea}>
          <div className={styles.loadingIconCircle}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 L13.2 10.8 L22 12 L13.2 13.2 L12 22 L10.8 13.2 L2 12 L10.8 10.8 Z"
                stroke="#e85d26"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className={styles.loadingTitle}>AI is thinking.</p>
          <p className={styles.loadingSubtitle}>Analyzing your research files</p>
          {uploadingFiles.length > 0 && (
            <div className={styles.fileList}>
              {uploadingFiles.map((name, i) => (
                <div key={i} className={styles.fileRow}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={styles.fileIcon}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#888" strokeWidth="1.5" strokeLinejoin="round" />
                    <polyline points="14 2 14 8 20 8" stroke="#888" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <span className={styles.fileRowName}>{name}</span>
                  <div className={styles.fileRowSpinner} />
                </div>
              ))}
            </div>
          )}
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} />
          </div>
          <p className={styles.finalizingText}>Finalizing results...</p>
          <div className={styles.dots}>
            {[0, 1, 2, 3, 4].map(i => (
              <span key={i} className={styles.dot} style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          {/* Upload zone — always visible */}
          <div
            className={`${styles.uploadZone} ${dragover ? styles.dragover : ''}`}
            onClick={triggerUpload}
            onDragOver={e => { e.preventDefault(); setDragover(true) }}
            onDragLeave={() => setDragover(false)}
            onDrop={handleDrop}
          >
            <span className={styles.uploadIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="17 8 12 3 7 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className={styles.uploadLabel}>
              {insights.length === 0 ? 'Upload research files' : '＋ Upload more files'}
            </span>
            <span className={styles.fileTypes}>PDF, DOCX, TXT, CSV</span>
          </div>

          {/* Results */}
          {insights.length > 0 && (
            <div className={styles.results}>
              <p className={styles.expandHint}>Expand file to see insights</p>
              {groups.map(([source, cards]) => (
                <FileGroup
                  key={source}
                  source={source}
                  cards={cards}
                  onAddToScene={onAddToScene}
                  onRemoveFromScene={onRemoveFromScene}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── File group accordion ──────────────────────────────────────────────────────

function FileGroup({
  source,
  cards,
  onAddToScene,
  onRemoveFromScene,
}: {
  source: string
  cards: InsightCard[]
  onAddToScene: (id: string) => void
  onRemoveFromScene: (id: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className={styles.fileGroup}>
      <button className={styles.fileGroupHeader} onClick={() => setOpen(v => !v)}>
        <span className={styles.fileGroupIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="4" width="4" height="16" rx="1" fill="currentColor" />
            <rect x="8" y="8" width="4" height="12" rx="1" fill="currentColor" />
            <rect x="14" y="2" width="4" height="18" rx="1" fill="currentColor" />
            <rect x="20" y="6" width="2" height="14" rx="1" fill="currentColor" />
          </svg>
        </span>
        <span className={styles.fileGroupName}>{source}</span>
        <span className={`${styles.fileGroupChevron} ${open ? styles.chevronOpen : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className={styles.fileGroupCards}>
          {cards.map(card => (
            <InsightCardView
              key={card.id}
              card={card}
              onAddToScene={() => onAddToScene(card.id)}
              onRemoveFromScene={() => onRemoveFromScene(card.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Individual insight card ───────────────────────────────────────────────────

function InsightCardView({
  card,
  onAddToScene,
  onRemoveFromScene,
}: {
  card: InsightCard
  onAddToScene: () => void
  onRemoveFromScene: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`${styles.insightCard} ${expanded ? styles.insightCardExpanded : ''}`}>
      <button className={styles.insightCardHeader} onClick={() => setExpanded(v => !v)}>
        <div className={styles.insightCardText}>
          <span className={styles.insightTitle}>{card.title}</span>
          {!expanded && (
            <span className={styles.insightDesc}>{card.description}</span>
          )}
        </div>
        <span className={`${styles.insightChevron} ${expanded ? styles.chevronOpen : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className={styles.insightCardBody}>
          <p className={styles.insightDescExpanded}>{card.description}</p>
          {card.added ? (
            <div className={styles.addedBadge}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Added to scene
              <button
                className={styles.removeFromSceneBtn}
                onClick={onRemoveFromScene}
                aria-label="Remove from scene"
                title="Remove from scene"
              >
                ×
              </button>
            </div>
          ) : (
            <button className={styles.addToSceneBtn} onClick={onAddToScene}>
              + Add to current scene
            </button>
          )}
          <button className={styles.askAiBtn}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 L13.2 10.8 L22 12 L13.2 13.2 L12 22 L10.8 13.2 L2 12 L10.8 10.8 Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            Ask AI
          </button>
          <p className={styles.aiHint}>AI will integrate this insight into the narrative</p>
        </div>
      )}
    </div>
  )
}
