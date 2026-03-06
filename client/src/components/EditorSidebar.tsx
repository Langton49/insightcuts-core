import styles from './EditorSidebar.module.css'

export type ActivePanel = 'find-clips' | 'insights' | 'narration' | 'podcast' | 'layouts' | 'music' | null

interface SidebarItem {
  id: ActivePanel | 'placeholder'
  label: string
  icon: React.ReactNode
  disabled?: boolean
  locked?: boolean // greyed but still clickable
}

interface Props {
  activePanel: ActivePanel
  onToggle: (panel: ActivePanel) => void
  narrationUnlocked: boolean
}

export function EditorSidebar({ activePanel, onToggle, narrationUnlocked }: Props) {
  const items: SidebarItem[] = [
    {
      id: 'find-clips',
      label: 'Find Clips',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
          <g fill="none">
            <path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z"/>
            <path fill="currentColor" d="M9.107 5.448c.598-1.75 3.016-1.803 3.725-.159l.06.16l.807 2.36a4 4 0 0 0 2.276 2.411l.217.081l2.36.806c1.75.598 1.803 3.016.16 3.725l-.16.06l-2.36.807a4 4 0 0 0-2.412 2.276l-.081.216l-.806 2.361c-.598 1.75-3.016 1.803-3.724.16l-.062-.16l-.806-2.36a4 4 0 0 0-2.276-2.412l-.216-.081l-2.36-.806c-1.751-.598-1.804-3.016-.16-3.724l.16-.062l2.36-.806A4 4 0 0 0 8.22 8.025l.081-.216zM11 6.094l-.806 2.36a6 6 0 0 1-3.49 3.649l-.25.091l-2.36.806l2.36.806a6 6 0 0 1 3.649 3.49l.091.25l.806 2.36l.806-2.36a6 6 0 0 1 3.49-3.649l.25-.09l2.36-.807l-2.36-.806a6 6 0 0 1-3.649-3.49l-.09-.25zM19 2a1 1 0 0 1 .898.56l.048.117l.35 1.026l1.027.35a1 1 0 0 1 .118 1.845l-.118.048l-1.026.35l-.35 1.027a1 1 0 0 1-1.845.117l-.048-.117l-.35-1.026l-1.027-.35a1 1 0 0 1-.118-1.845l.118-.048l1.026-.35l.35-1.027A1 1 0 0 1 19 2"/>
          </g>
        </svg>
      ),
    },
    {
      id: 'insights',
      label: 'Insights',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="9" y1="14" x2="15" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'layouts',
      label: 'Layouts',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      id: 'music',
      label: 'Music',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      id: 'narration',
      label: 'Narration',
      locked: !narrationUnlocked,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'podcast',
      label: 'Podcast',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.8 6.8a7.5 7.5 0 000 10.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M17.2 6.8a7.5 7.5 0 010 10.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M4 4a12 12 0 000 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M20 4a12 12 0 010 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
  ]

  return (
    <aside className={styles.sidebar}>
      {items.map((item, i) => {
        const isActive = item.id !== 'placeholder' && item.id === activePanel
        const btnClass = [
          styles.iconBtn,
          isActive ? styles.active : '',
          item.disabled ? styles.disabled : '',
          item.locked ? styles.locked : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={i}
            className={btnClass}
            onClick={() => {
              if (!item.disabled && item.id !== 'placeholder') {
                onToggle(item.id as ActivePanel)
              }
            }}
            title={item.label}
          >
            <span className={styles.iconInner}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </button>
        )
      })}
    </aside>
  )
}
