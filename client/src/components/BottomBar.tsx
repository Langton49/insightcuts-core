import styles from './BottomBar.module.css'

interface Props {
  selectedCount: number
  onWrapUp: () => void
  isAssembling: boolean
}

export function BottomBar({ selectedCount, onWrapUp, isAssembling }: Props) {
  const active = selectedCount > 0

  return (
    <div className={styles.bar}>
      <div className={styles.counter}>
        <span className={`${styles.dot} ${active ? styles.dotActive : ''}`} />
        <span className={styles.label}>{selectedCount} clips selected</span>
      </div>
      <button
        className={`${styles.button} ${active ? styles.buttonActive : ''}`}
        onClick={onWrapUp}
        disabled={!active || isAssembling}
      >
        {isAssembling ? 'Assembling…' : 'Wrap Up'}
      </button>
    </div>
  )
}
