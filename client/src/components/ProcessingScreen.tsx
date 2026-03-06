import { useState, useEffect, useRef } from 'react'
import type { StepState } from '../pages/ProcessingPage'
import styles from './ProcessingScreen.module.css'
import processingTrack1 from '../audios/processing/denis-pavlov-music-bossa-nova-jazz-piano-summer-cafe-podcast-music-398166.mp3'
import processingTrack2 from '../audios/processing/hitslab-bossa-nova-bossa-nova-cafe-music-457829.mp3'
import processingTrack3 from '../audios/processing/music_for_videos-jazz-bossa-nova-163669.mp3'

const PROCESSING_TRACKS = [processingTrack1, processingTrack2, processingTrack3]

const STEP_LABELS = [
  'Indexing video',
  'Finding clips',
]

const TITLES = [
  'Lights, camera, action',
  'Rolling the reels',
  'Developing the footage',
  'Cutting to the good stuff',
  'The director approves',
  'Final cut in progress',
  'Scene by scene',
  'Cue the spotlight',
  'Calling it a wrap',
  'In post-production',
]

interface Props {
  steps: StepState[]
  projectName: string
}

export function ProcessingScreen({ steps, projectName }: Props) {
  const completedCount = steps.filter(s => s === 'complete').length
  const progress = Math.round((completedCount / steps.length) * 100)

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <HeaderIcon />
        <RotatingTitle />
        <p className={styles.subtitle}>"{projectName}"</p>
        <Waveform />
        <ChecklistCard steps={steps} progress={progress} />
      </div>
    </div>
  )
}

// ─── Header Icon ────────────────────────────────────────────────────────────

function HeaderIcon() {
  return (
    <div className={styles.iconCircle}>
      <svg xmlns="http://www.w3.org/2000/svg" width="33" height="33" viewBox="0 0 24 24">
          <title>ai-line</title><g fill="none">
            <path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z"/>
            <path fill="#EA580C" d="M9.107 5.448c.598-1.75 3.016-1.803 3.725-.159l.06.16l.807 2.36a4 4 0 0 0 2.276 2.411l.217.081l2.36.806c1.75.598 1.803 3.016.16 3.725l-.16.06l-2.36.807a4 4 0 0 0-2.412 2.276l-.081.216l-.806 2.361c-.598 1.75-3.016 1.803-3.724.16l-.062-.16l-.806-2.36a4 4 0 0 0-2.276-2.412l-.216-.081l-2.36-.806c-1.751-.598-1.804-3.016-.16-3.724l.16-.062l2.36-.806A4 4 0 0 0 8.22 8.025l.081-.216zM11 6.094l-.806 2.36a6 6 0 0 1-3.49 3.649l-.25.091l-2.36.806l2.36.806a6 6 0 0 1 3.649 3.49l.091.25l.806 2.36l.806-2.36a6 6 0 0 1 3.49-3.649l.25-.09l2.36-.807l-2.36-.806a6 6 0 0 1-3.649-3.49l-.09-.25zM19 2a1 1 0 0 1 .898.56l.048.117l.35 1.026l1.027.35a1 1 0 0 1 .118 1.845l-.118.048l-1.026.35l-.35 1.027a1 1 0 0 1-1.845.117l-.048-.117l-.35-1.026l-1.027-.35a1 1 0 0 1-.118-1.845l.118-.048l1.026-.35l.35-1.027A1 1 0 0 1 19 2"/>
            </g>
            </svg>
    </div>
  )
}

// ─── Rotating Title ──────────────────────────────────────────────────────────

function RotatingTitle() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % TITLES.length)
        setVisible(true)
      }, 350)
    }, 2500)
    return () => clearInterval(id)
  }, [])

  return (
    <h1
      className={styles.title}
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease' }}
    >
      {TITLES[index]}
    </h1>
  )
}

// ─── Waveform Canvas ─────────────────────────────────────────────────────────

const BAR_COUNT = 28
const BAR_W = 5
const BAR_GAP = 4

function Waveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  // Procedural canvas animation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const t = Date.now() / 1000
      const totalW = BAR_COUNT * (BAR_W + BAR_GAP) - BAR_GAP
      const startX = (W - totalW) / 2

      for (let i = 0; i < BAR_COUNT; i++) {
        const h =
          H *
          (0.12 +
            0.3 * Math.abs(Math.sin(t * 1.5 + i * 0.45)) +
            0.25 * Math.abs(Math.sin(t * 2.8 + i * 0.9)) +
            0.15 * Math.abs(Math.sin(t * 4.2 + i * 1.4)))

        const x = startX + i * (BAR_W + BAR_GAP)
        const y = (H - h) / 2
        ctx.fillStyle = '#F97316'
        ctx.fillRect(x, y, BAR_W, h)
      }
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Background music — pick a random processing track and play it looped
  useEffect(() => {
    const url = PROCESSING_TRACKS[Math.floor(Math.random() * PROCESSING_TRACKS.length)]
    const audio = new Audio(url)
    audio.loop = true
    audio.volume = 0.35
    audio.play().catch(() => {})
    return () => { audio.pause() }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={styles.waveform}
      width={BAR_COUNT * (BAR_W + BAR_GAP) - BAR_GAP + 40}
      height={60}
    />
  )
}

// ─── Checklist Card ──────────────────────────────────────────────────────────

function ChecklistCard({ steps, progress }: { steps: StepState[]; progress: number }) {
  return (
    <div className={styles.card}>
      <ul className={styles.list}>
        {STEP_LABELS.map((label, i) => (
          <StepRow key={label} label={label} state={steps[i] ?? 'pending'} />
        ))}
      </ul>
      <div className={styles.progressSection}>
        <div className={styles.progressHeader}>
          <span className={styles.progressLabel}>Progress</span>
          <span className={styles.progressPct}>{progress}%</span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  return (
    <li className={`${styles.stepRow} ${styles[state]}`}>
      <span className={styles.stepIcon}>
        {state === 'complete' && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <polyline
              points="2 6 5 9 10 3"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className={styles.stepLabel}>{label}</span>
    </li>
  )
}
