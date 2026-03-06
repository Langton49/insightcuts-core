import { Link } from 'react-router-dom'
import styles from './EditorTopNav.module.css'

interface Props {
  onShare: () => void
}

export function EditorTopNav({ onShare }: Props) {
  return (
    <nav className={styles.nav}>
      <Link to="/" className={styles.logo}>
        <div className={styles.logoSquare} />
        <span className={styles.logoText}>InsightCuts</span>
      </Link>
      <div className={styles.right}>
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
