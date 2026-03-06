import type { EditorClip } from '../types'
import { VOICES, EmptyState, LoadingState } from './NarrationPanel'
import styles from './NarrationPanel.module.css'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clips: EditorClip[]
  script: string
  loading: boolean
  rendering: boolean
  downloadUrl: string | null
  voice: string
  error?: string | null
  onClose: () => void
  onGenerateScript: () => void
  onUpdateScript: (text: string) => void
  onVoiceChange: (voiceId: string) => void
  onGeneratePodcast: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PodcastPanel({
  clips,
  script,
  loading,
  rendering,
  downloadUrl,
  voice,
  error,
  onClose,
  onGenerateScript,
  onUpdateScript,
  onVoiceChange,
  onGeneratePodcast,
}: Props) {
  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.8 6.8a7.5 7.5 0 000 10.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M17.2 6.8a7.5 7.5 0 010 10.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M4 4a12 12 0 000 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M20 4a12 12 0 010 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          Podcast
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* Body */}
      {loading ? (
        <LoadingState sub={`Writing a podcast narrative for your ${clips.length} scenes`} />
      ) : script === '' ? (
        <EmptyState clips={clips} onGenerate={onGenerateScript} label="podcast script" />
      ) : (
        <div className={styles.content}>
          {/* Script section */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Script</span>
            <div className={styles.scriptCard}>
              <div className={styles.scriptNav}>
                <span className={styles.sceneLabel}>Full narrative</span>
              </div>
              <textarea
                className={styles.scriptTextarea}
                value={script}
                onChange={e => onUpdateScript(e.target.value)}
                placeholder="Your AI podcast script will show up here"
                style={{ minHeight: 200 }}
              />
            </div>
          </div>

          {/* Voice section */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Voice</span>
            <div className={styles.selectWrap}>
              <select
                className={styles.select}
                value={voice}
                onChange={e => onVoiceChange(e.target.value)}
              >
                {VOICES.map(v => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              <span className={styles.selectChevron}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>

          {/* Download link once rendered */}
          {downloadUrl && !rendering && (
            <a
              href={downloadUrl}
              download="podcast.mp3"
              className={styles.primaryBtn}
              style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', textDecoration: 'none' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v13M5 14l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download podcast
            </a>
          )}

          {/* Error */}
          {error && (
            <p style={{ fontSize: 12, color: '#c0392b', margin: '0 0 8px', wordBreak: 'break-word' }}>
              {error}
            </p>
          )}

          {/* CTA */}
          <button className={styles.primaryBtn} onClick={onGeneratePodcast} disabled={rendering}>
            {rendering ? 'Generating audio…' : downloadUrl ? 'Re-generate podcast' : 'Generate podcast'}
          </button>
          <p className={styles.hint}>A podcast (.mp3) file will be generated from your script</p>
        </div>
      )}
    </div>
  )
}
