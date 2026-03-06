import { useRef, useEffect } from 'react'
import type { EditorClip } from '../types'
import { ClipCard } from './ClipCard'
import styles from './ClipReel.module.css'

interface Props {
  clips: EditorClip[]
  selectedIndex: number
  onSelectClip: (index: number) => void
  onToggleClipSelected: (index: number) => void
}

export function ClipReel({ clips, selectedIndex, onSelectClip, onToggleClipSelected }: Props) {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Scroll active card into view when selection changes
  useEffect(() => {
    const el = cardRefs.current[selectedIndex]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [selectedIndex])

  return (
    <div className={styles.reel}>
      {clips.map((clip, i) => (
        <div key={clip.index} ref={el => { cardRefs.current[i] = el }}>
          <ClipCard
            clip={clip}
            isActive={i === selectedIndex}
            onSelect={() => onSelectClip(i)}
            onToggleSelected={() => onToggleClipSelected(i)}
          />
        </div>
      ))}
    </div>
  )
}
