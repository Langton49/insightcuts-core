import type { EditorClip } from '../types'
import styles from './ShareModal.module.css'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

interface Props {
  jobId: string
  clips: EditorClip[]
  onClose: () => void
}

export function ShareModal({ jobId, clips, onClose }: Props) {
  const selected = clips.filter(c => c.selected)

  const handleDownloadAll = () => {
    selected.forEach(clip => {
      const a = document.createElement('a')
      a.href = `/api/output/${jobId}/clips/${clip.index}`
      a.download = `${clip.sceneLabel.replace(/\s+/g, '-').toLowerCase()}.mp4`
      a.click()
    })
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.title}>Export clips</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {selected.length === 0 ? (
          <p className={styles.empty}>No clips selected for export.</p>
        ) : (
          <ul className={styles.list}>
            {selected.map(clip => (
              <li key={clip.index} className={styles.item}>
                <div>
                  <div className={styles.itemLabel}>{clip.sceneLabel}</div>
                  <div className={styles.itemMeta}>{formatDuration(clip.duration)}</div>
                </div>
                <a
                  href={`/api/output/${jobId}/clips/${clip.index}`}
                  download={`${clip.sceneLabel.replace(/\s+/g, '-').toLowerCase()}.mp4`}
                  className={styles.downloadLink}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          {selected.length > 1 && (
            <button className={styles.downloadAllBtn} onClick={handleDownloadAll}>
              Download all ({selected.length})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
