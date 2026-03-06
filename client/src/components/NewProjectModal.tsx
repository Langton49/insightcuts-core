import { useState } from 'react'
import styles from './NewProjectModal.module.css'

interface Props {
  onClose?: () => void   // undefined = non-dismissable (first-time creation)
  onSubmit: (name: string) => void
}

export function NewProjectModal({ onClose, onSubmit }: Props) {
  const [name, setName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onSubmit(trimmed)
  }

  const handleOverlayClick = () => {
    if (onClose) onClose()
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>New project</h2>
          {onClose && (
            <button className={styles.close} onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="project-name">
            Project name
          </label>
          <input
            id="project-name"
            className={styles.input}
            type="text"
            placeholder="e.g. In-Vehicle UX Test"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.submit} disabled={!name.trim()}>
            Create project
          </button>
        </form>
      </div>
    </div>
  )
}
