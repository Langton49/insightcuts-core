import { Link } from 'react-router-dom'
import styles from './EditorTopNav.module.css'

interface Props {
  onShare: () => void
  onGenerateBrief: () => void
  isAssembling: boolean
  briefUrl: string | null
  selectedCount: number
}

export function EditorTopNav({ onShare, onGenerateBrief, isAssembling, briefUrl, selectedCount }: Props) {
  return (
    <nav className={styles.nav}>
      <Link to="/" className={styles.logo}>
        <div className={styles.logoSquare} />
        <span className={styles.logoText}>InsightCuts</span>
      </Link>
      <div className={styles.right}>
        {briefUrl && !isAssembling && (
          <>
            <span className={styles.briefReady}>Brief ready</span>
            <a href={briefUrl} download="brief.mp4" className={styles.downloadBtn}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v13M5 14l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download
            </a>
          </>
        )}
        <button
          className={styles.generateBriefBtn}
          onClick={onGenerateBrief}
          disabled={selectedCount === 0 || isAssembling}
        >
          {isAssembling ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="40 20" />
              </svg>
              Assembling…
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
              </svg>
              Generate Brief
            </>
          )}
        </button>
        <button className={styles.shareBtn} onClick={onShare}>
          Share
        </button>
        <div className={styles.avatar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" fill="#fff" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#fff" />
          </svg>
        </div>
      </div>
    </nav>
  )
}
