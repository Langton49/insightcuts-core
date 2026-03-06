import { useState, useEffect, useRef } from 'react'
import styles from './MusicPanel.module.css'

// ─── Audio imports ────────────────────────────────────────────────────────────

import bg1 from '../audios/background/audiocoffee-innovative-technology-242948.mp3'
import bg2 from '../audios/background/denis-pavlov-music-bossa-nova-jazz-piano-summer-cafe-podcast-music-398166.mp3'
import bg3 from '../audios/background/evgeniach-innovative-306122.mp3'
import bg4 from '../audios/background/hitslab-bossa-nova-bossa-nova-cafe-music-457829.mp3'
import bg5 from '../audios/background/ivan_luzan-innovative-146729.mp3'
import bg6 from '../audios/background/megisss-innovative-world-2-464248.mp3'
import bg7 from '../audios/background/music_for_videos-jazz-bossa-nova-163669.mp3'
import bg8 from '../audios/background/paulyudin-innovative-corporate-technology-317820.mp3'
import bg9 from '../audios/background/pumpupthemind-tech-innovative-403426.mp3'

// ─── Track catalogue ──────────────────────────────────────────────────────────

export interface Track {
  id: string
  name: string
  mood: Mood
  duration: number  // seconds — loaded from audio metadata at runtime
  audioUrl: string
}

export type Mood = 'Corporate' | 'Calm' | 'Upbeat'

export const TRACKS: Track[] = [
  { id: 'bg1', name: 'Innovative Technology', mood: 'Corporate', duration: 0, audioUrl: bg1 },
  { id: 'bg2', name: 'Bossa Nova Café',        mood: 'Calm',      duration: 0, audioUrl: bg2 },
  { id: 'bg3', name: 'Creative Pulse',         mood: 'Corporate', duration: 0, audioUrl: bg3 },
  { id: 'bg4', name: 'Bossa Nova Lounge',      mood: 'Calm',      duration: 0, audioUrl: bg4 },
  { id: 'bg5', name: 'Fresh Momentum',         mood: 'Upbeat',    duration: 0, audioUrl: bg5 },
  { id: 'bg6', name: 'Innovative World',       mood: 'Upbeat',    duration: 0, audioUrl: bg6 },
  { id: 'bg7', name: 'Jazz Bossa Nova',        mood: 'Calm',      duration: 0, audioUrl: bg7 },
  { id: 'bg8', name: 'Corporate Technology',   mood: 'Corporate', duration: 0, audioUrl: bg8 },
  { id: 'bg9', name: 'Tech Drive',             mood: 'Corporate', duration: 0, audioUrl: bg9 },
]

const MOODS: (Mood | 'All')[] = ['All', 'Corporate', 'Calm', 'Upbeat']

const MOOD_COLORS: Record<Mood, string> = {
  Corporate: '#1f3d6b',
  Calm:      '#1a6b4a',
  Upbeat:    '#b85e00',
}

function formatDuration(s: number) {
  if (s === 0) return '—'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  selectedTrackId: string | null
  onClose: () => void
  onApplyTrack: (trackId: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MusicPanel({ selectedTrackId, onClose, onApplyTrack }: Props) {
  const [filterMood, setFilterMood] = useState<Mood | 'All'>('All')
  const [localSelected, setLocalSelected] = useState<string | null>(selectedTrackId)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [durations, setDurations] = useState<Record<string, number>>({})
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const visible = filterMood === 'All'
    ? TRACKS
    : TRACKS.filter(t => t.mood === filterMood)

  // Preload durations from audio metadata for all tracks on mount
  useEffect(() => {
    TRACKS.forEach(track => {
      const a = new Audio(track.audioUrl)
      a.addEventListener('loadedmetadata', () => {
        setDurations(prev => ({ ...prev, [track.id]: Math.floor(a.duration) }))
      })
    })
  }, [])

  // Stop and clean up audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const handlePlay = (id: string) => {
    if (playingId === id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()
    const track = TRACKS.find(t => t.id === id)
    if (!track) return
    const audio = new Audio(track.audioUrl)
    audio.loop = true
    audio.volume = 0.7
    audio.play().catch(() => {})
    audioRef.current = audio
    setPlayingId(id)
  }

  const handleSelect = (id: string) => {
    setLocalSelected(id)
    if (playingId !== id) handlePlay(id)
  }

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.titleIcon}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
          Music
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* Mood filter */}
      <div className={styles.filterRow}>
        {MOODS.map(mood => (
          <button
            key={mood}
            className={`${styles.filterChip} ${filterMood === mood ? styles.filterChipActive : ''}`}
            onClick={() => setFilterMood(mood)}
          >
            {mood}
          </button>
        ))}
      </div>

      {/* Currently applied banner */}
      {selectedTrackId && (
        <div className={styles.appliedBanner}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {TRACKS.find(t => t.id === selectedTrackId)?.name ?? 'Track'} applied
        </div>
      )}

      {/* Track list */}
      <div className={styles.trackList}>
        {visible.map(track => {
          const isSelected = localSelected === track.id
          const isPlaying = playingId === track.id
          const dur = durations[track.id] ?? 0
          return (
            <div
              key={track.id}
              className={`${styles.trackRow} ${isSelected ? styles.trackRowSelected : ''}`}
              onClick={() => handleSelect(track.id)}
            >
              {/* Play / pause button */}
              <button
                className={`${styles.playBtn} ${isPlaying ? styles.playBtnActive : ''}`}
                onClick={e => { e.stopPropagation(); handlePlay(track.id) }}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  // Pause icon
                  <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
                    <rect x="0" y="0" width="3.5" height="12" rx="1" />
                    <rect x="6.5" y="0" width="3.5" height="12" rx="1" />
                  </svg>
                ) : (
                  // Play icon
                  <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
                    <path d="M1 0L10 6L1 12V0Z" />
                  </svg>
                )}
              </button>

              {/* Waveform animation (shows when playing) */}
              <div className={styles.waveWrap}>
                {isPlaying ? (
                  <div className={styles.wave}>
                    {[1, 2, 3, 4, 5].map(b => (
                      <span
                        key={b}
                        className={styles.waveBar}
                        style={{ animationDelay: `${(b - 1) * 0.12}s` }}
                      />
                    ))}
                  </div>
                ) : (
                  <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
                    <rect x="0"  y="5" width="3" height="6"  rx="1.5" fill="#ddd" />
                    <rect x="5"  y="2" width="3" height="12" rx="1.5" fill="#ddd" />
                    <rect x="10" y="0" width="3" height="16" rx="1.5" fill="#ddd" />
                    <rect x="15" y="3" width="3" height="10" rx="1.5" fill="#ddd" />
                    <rect x="20" y="6" width="2" height="4"  rx="1"   fill="#ddd" />
                  </svg>
                )}
              </div>

              {/* Track info */}
              <div className={styles.trackInfo}>
                <span className={styles.trackName}>{track.name}</span>
                <div className={styles.trackMeta}>
                  <span
                    className={styles.moodChip}
                    style={{ background: MOOD_COLORS[track.mood] + '22', color: MOOD_COLORS[track.mood] }}
                  >
                    {track.mood}
                  </span>
                  <span className={styles.trackDuration}>{formatDuration(dur)}</span>
                </div>
              </div>

              {/* Selected check */}
              {isSelected && (
                <span className={styles.selectedCheck}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <circle cx="6.5" cy="6.5" r="6.5" fill="#e85d26" />
                    <path d="M3.5 6.5L5.5 8.5L9.5 4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* CTA */}
      <button
        className={styles.applyBtn}
        disabled={!localSelected}
        onClick={() => localSelected && onApplyTrack(localSelected)}
      >
        Apply track
      </button>
      <p className={styles.hint}>Track will be mixed into the exported brief at low volume</p>
    </div>
  )
}
