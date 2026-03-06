import { useState } from 'react'
import type { EditorClip, InsightCard, LayoutStyle } from '../types'
import styles from './LayoutsPanel.module.css'

// ─── Layout definitions ───────────────────────────────────────────────────────

interface LayoutOption {
  id: LayoutStyle
  name: string
  description: string
}

const LAYOUTS: LayoutOption[] = [
  { id: 'split-screen',       name: 'Split Screen',         description: 'Video on left, annotations on right' },
  { id: 'bottom-top',         name: 'Bottom / Top',         description: 'Video on top, annotations on bottom' },
  { id: 'overlay',            name: 'Overlay',              description: 'Annotations overlay the video' },
  { id: 'picture-in-picture', name: 'Picture-in-Picture',   description: 'Small video with large data visualization' },
  { id: 'sequential',         name: 'Sequential',           description: 'Alternating video and insight slides' },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clips: EditorClip[]
  selectedClipIndex: number
  insights: InsightCard[]
  globalLayout: LayoutStyle
  onClose: () => void
  onApplyLayout: (layout: LayoutStyle, scope: 'all' | 'current', clipIndex: number) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LayoutsPanel({
  clips,
  selectedClipIndex,
  insights,
  globalLayout,
  onClose,
  onApplyLayout,
}: Props) {
  const currentClip = clips[selectedClipIndex] ?? null
  const effectiveLayout = currentClip?.layoutStyle ?? globalLayout

  const [applyScope, setApplyScope] = useState<'all' | 'current'>('all')
  const [selectedLayout, setSelectedLayout] = useState<LayoutStyle>(effectiveLayout)

  // Insights attached to the current clip
  const clipInsights = insights.filter(
    ins => ins.added && ins.addedToClipIndex === selectedClipIndex,
  )
  const [previewInsightId, setPreviewInsightId] = useState<string | null>(
    clipInsights[0]?.id ?? null,
  )
  const previewInsight = clipInsights.find(ins => ins.id === previewInsightId) ?? clipInsights[0]
  const previewText = previewInsight?.title ?? 'Your insight text here'
  const previewDesc = previewInsight?.description ?? 'Add confirmed insights to see a real preview'

  const appliedLayout = applyScope === 'current' ? effectiveLayout : globalLayout
  const isApplied = (id: LayoutStyle) => id === appliedLayout

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="13" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="13" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
          Layouts
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className={styles.content}>
        {/* Apply to toggle */}
        <div className={styles.applyRow}>
          <span className={styles.applyLabel}>Apply to</span>
          <div className={styles.applyToggle}>
            <button
              className={`${styles.applyBtn} ${applyScope === 'all' ? styles.applyBtnActive : ''}`}
              onClick={() => setApplyScope('all')}
            >
              {applyScope === 'all' && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              All scenes
            </button>
            <button
              className={`${styles.applyBtn} ${applyScope === 'current' ? styles.applyBtnActive : ''}`}
              onClick={() => setApplyScope('current')}
            >
              {applyScope === 'current' && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              Current scene
            </button>
          </div>
        </div>

        {/* Thumbnail preview */}
        <LayoutPreview
          clip={currentClip}
          layout={selectedLayout}
          previewText={previewText}
          previewDesc={previewDesc}
        />

        {/* Insight picker (shown when clip has multiple insights) */}
        {clipInsights.length > 1 && (
          <div className={styles.insightPickerRow}>
            <span className={styles.insightPickerLabel}>Preview insight</span>
            <select
              className={styles.insightPicker}
              value={previewInsightId ?? ''}
              onChange={e => setPreviewInsightId(e.target.value)}
            >
              {clipInsights.map(ins => (
                <option key={ins.id} value={ins.id}>{ins.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Layout list */}
        <span className={styles.sectionLabel}>Select layout style</span>
        <div className={styles.layoutList}>
          {LAYOUTS.map(layout => (
            <button
              key={layout.id}
              className={`${styles.layoutItem} ${selectedLayout === layout.id ? styles.layoutItemSelected : ''}`}
              onClick={() => setSelectedLayout(layout.id)}
            >
              <LayoutThumbnail id={layout.id} />
              <div className={styles.layoutInfo}>
                <span className={styles.layoutName}>{layout.name}</span>
                <span className={styles.layoutDesc}>{layout.description}</span>
              </div>
              {isApplied(layout.id) && (
                <span className={styles.appliedBadge}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Applied
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* CTA */}
      <button
        className={styles.changeBtn}
        onClick={() => onApplyLayout(selectedLayout, applyScope, selectedClipIndex)}
      >
        Change layout
      </button>
    </div>
  )
}

// ─── Layout preview (thumbnail + CSS overlay) ─────────────────────────────────

function LayoutPreview({
  clip,
  layout,
  previewText,
  previewDesc,
}: {
  clip: EditorClip | null
  layout: LayoutStyle
  previewText: string
  previewDesc: string
}) {
  const thumbStyle = clip?.thumbnailUrl
    ? { backgroundImage: `url(${clip.thumbnailUrl})` }
    : {}

  return (
    <div className={styles.previewWrap}>
      <div className={`${styles.previewFrame} ${styles[`layout_${layout.replace(/-/g, '_')}`]}`}>
        {/* Video zone */}
        <div className={styles.previewVideo} style={thumbStyle}>
          {!clip?.thumbnailUrl && (
            <span className={styles.previewVideoLabel}>{clip?.sceneLabel ?? 'Scene'}</span>
          )}
        </div>

        {/* Text / annotation zone */}
        <div className={styles.previewAnnotation}>
          <p className={styles.previewAnnotationTitle}>{previewText}</p>
          <p className={styles.previewAnnotationDesc}>{previewDesc}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Small schematic thumbnails for the list ──────────────────────────────────

function LayoutThumbnail({ id }: { id: LayoutStyle }) {
  return (
    <div className={`${styles.thumb} ${styles[`thumb_${id.replace(/-/g, '_')}`]}`}>
      <div className={styles.thumbVideo} />
      <div className={styles.thumbText} />
    </div>
  )
}
