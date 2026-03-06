import styles from './TopNav.module.css'

interface TopNavProps {
  onNewProject: () => void
}

export function TopNav({ onNewProject }: TopNavProps) {
  return (
    <nav className={styles.nav}>
      <div className={styles.logo}>
        <span className={styles.logoIcon} />
        <span className={styles.logoText}>InsightCuts</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.newProject} onClick={onNewProject}>
          <span className={styles.plus}>+</span> New project
        </button>
        <div className={styles.avatar} />
      </div>
    </nav>
  )
}
