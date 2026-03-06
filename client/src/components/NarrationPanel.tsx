import { useState } from 'react'
import type { EditorClip, SceneScript } from '../types'
import styles from './NarrationPanel.module.css'

// ─── Voices ───────────────────────────────────────────────────────────────────
// Labels map to ElevenLabs voice IDs — swap IDs for real ones when wiring backend

export const VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Professional' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Conversational' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Warm' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Authoritative' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Energetic' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Casual' },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clips: EditorClip[]
  scripts: SceneScript[]
  loading: boolean
  voice: string
  isLocked?: boolean
  onClose: () => void
  onUnlock?: () => void
  onGenerateScript: () => void
  onUpdateScript: (clipIndex: number, text: string) => void
  onVoiceChange: (voiceId: string) => void
  onAddNarration: () => void
  onRefineScript: (clipIndex: number, instruction: string) => Promise<void>
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NarrationPanel({
  clips,
  scripts,
  loading,
  voice,
  isLocked,
  onClose,
  onUnlock,
  onGenerateScript,
  onUpdateScript,
  onVoiceChange,
  onAddNarration,
  onRefineScript,
}: Props) {
  const [sceneIdx, setSceneIdx] = useState(0)
  const [askText, setAskText] = useState('')
  const [refining, setRefining] = useState(false)

  const handleAskAI = async () => {
    if (!askText.trim() || !current || refining) return
    setRefining(true)
    try {
      await onRefineScript(current.clipIndex, askText.trim())
      setAskText('')
    } finally {
      setRefining(false)
    }
  }
  const total = scripts.length
  const current = scripts[Math.min(sceneIdx, total - 1)]

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          Narration
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* Body */}
      {isLocked ? (
        <LockedState onUnlock={onUnlock} />
      ) : loading ? (
        <LoadingState sub={`Crafting narration for ${clips.filter(c => c.selected).length} scene${clips.filter(c => c.selected).length !== 1 ? 's' : ''}`} />
      ) : scripts.length === 0 ? (
        <EmptyState clips={clips.filter(c => c.selected)} onGenerate={onGenerateScript} label="narration script" />
      ) : (
        <div className={styles.content}>
          {/* Script section */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Script</span>
            <div className={styles.scriptCard}>
              <div className={styles.scriptNav}>
                <span className={styles.sceneLabel}>
                  {current?.sceneLabel} <span className={styles.sceneTotal}>/ {total}</span>
                </span>
                <div className={styles.navBtns}>
                  <button
                    className={styles.navBtn}
                    onClick={() => setSceneIdx(i => Math.max(0, i - 1))}
                    disabled={sceneIdx === 0}
                  >‹</button>
                  <button
                    className={styles.navBtn}
                    onClick={() => setSceneIdx(i => Math.min(total - 1, i + 1))}
                    disabled={sceneIdx === total - 1}
                  >›</button>
                </div>
              </div>
              <textarea
                className={styles.scriptTextarea}
                value={current?.script ?? ''}
                onChange={e => current && onUpdateScript(current.clipIndex, e.target.value)}
                placeholder="Your AI script will show up here"
              />
              <div className={styles.askRow}>
                <input
                  className={styles.askInput}
                  value={askText}
                  onChange={e => setAskText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAskAI()}
                  placeholder="Ask AI to edit…"
                  disabled={refining}
                />
                <button
                  className={styles.askBtn}
                  onClick={handleAskAI}
                  disabled={!askText.trim() || refining}
                  title="Ask AI"
                >
                  {refining ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="56" strokeDashoffset="20" strokeLinecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                      </circle>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M9.107 5.448c.598-1.75 3.016-1.803 3.725-.159l.06.16.807 2.36a4 4 0 002.276 2.411l.217.081 2.36.806c1.75.598 1.803 3.016.16 3.725l-.16.06-2.36.807a4 4 0 00-2.412 2.276l-.081.216-.806 2.361c-.598 1.75-3.016 1.803-3.724.16l-.062-.16-.806-2.36a4 4 0 00-2.276-2.412l-.216-.081-2.36-.806c-1.751-.598-1.804-3.016-.16-3.724l.16-.062 2.36-.806A4 4 0 008.22 8.025l.081-.216z" fill="currentColor"/>
                    </svg>
                  )}
                </button>
              </div>
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

          {/* CTA */}
          <button className={styles.primaryBtn} onClick={onAddNarration}>
            Regenerate scripts
          </button>
          <p className={styles.hint}>Re-runs AI script generation, replacing your current scripts</p>
        </div>
      )}
    </div>
  )
}

// ─── Locked state ─────────────────────────────────────────────────────────────

function LockedState({ onUnlock }: { onUnlock?: () => void }) {
  return (
    <div className={styles.emptyArea}>
      <div className={styles.emptyIconCircle}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="5" y="11" width="14" height="10" rx="2" stroke="#EA580C" strokeWidth="1.5" />
          <path d="M8 11V7a4 4 0 018 0v4" stroke="#EA580C" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className={styles.emptyTitle}>Narration & Podcast</p>
      <p className={styles.emptySubtitle}>
        Once you've selected your clips, uploaded your reports, and chosen a layout and music — generate narration to unlock voiceover and podcast.
      </p>
      <button className={styles.primaryBtn} onClick={onUnlock} style={{ marginTop: 8 }}>
        Generate narration
      </button>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

export function EmptyState({
  clips,
  onGenerate,
  label,
}: {
  clips: EditorClip[]
  onGenerate: () => void
  label: string
}) {
  return (
    <div className={styles.emptyArea}>
      <div className={styles.emptyIconCircle}>
          <svg xmlns="http://www.w3.org/2000/svg" width="33" height="33" viewBox="0 0 24 24">
          <title>ai-line</title><g fill="none">
            <path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z"/>
            <path fill="#EA580C" d="M9.107 5.448c.598-1.75 3.016-1.803 3.725-.159l.06.16l.807 2.36a4 4 0 0 0 2.276 2.411l.217.081l2.36.806c1.75.598 1.803 3.016.16 3.725l-.16.06l-2.36.807a4 4 0 0 0-2.412 2.276l-.081.216l-.806 2.361c-.598 1.75-3.016 1.803-3.724.16l-.062-.16l-.806-2.36a4 4 0 0 0-2.276-2.412l-.216-.081l-2.36-.806c-1.751-.598-1.804-3.016-.16-3.724l.16-.062l2.36-.806A4 4 0 0 0 8.22 8.025l.081-.216zM11 6.094l-.806 2.36a6 6 0 0 1-3.49 3.649l-.25.091l-2.36.806l2.36.806a6 6 0 0 1 3.649 3.49l.091.25l.806 2.36l.806-2.36a6 6 0 0 1 3.49-3.649l.25-.09l2.36-.807l-2.36-.806a6 6 0 0 1-3.649-3.49l-.09-.25zM19 2a1 1 0 0 1 .898.56l.048.117l.35 1.026l1.027.35a1 1 0 0 1 .118 1.845l-.118.048l-1.026.35l-.35 1.027a1 1 0 0 1-1.845.117l-.048-.117l-.35-1.026l-1.027-.35a1 1 0 0 1-.118-1.845l.118-.048l1.026-.35l.35-1.027A1 1 0 0 1 19 2"/>
            </g>
            </svg>
      </div>
      <p className={styles.emptyTitle}>Generate {label}</p>
      <p className={styles.emptySubtitle}>
        AI will write a script for each of your {clips.filter(c => c.selected).length} scene{clips.filter(c => c.selected).length !== 1 ? 's' : ''}.
        You can edit before generating audio.
      </p>
      <button className={styles.primaryBtn} onClick={onGenerate} style={{ marginTop: 8 }}>
        Generate script
      </button>
    </div>
  )
}

export function LoadingState({ sub }: { sub: string }) {
  return (
    <div className={styles.loadingArea}>
      <div className={styles.loadingIconCircle}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2 L13.2 10.8 L22 12 L13.2 13.2 L12 22 L10.8 13.2 L2 12 L10.8 10.8 Z"
            stroke="#EA580C"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className={styles.loadingTitle}>Writing your script.</p>
      <p className={styles.loadingSubtitle}>{sub}</p>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} />
      </div>
      <div className={styles.dots}>
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className={styles.dot} style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )
}
