import { useEffect, useState } from 'react'
import type { EditorClip } from '../types'
import styles from './ShareModal.module.css'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

interface SlackStatus {
  connected: boolean
  workspace?: { id: string; name: string }
}

interface Channel {
  id: string
  name: string
}

interface Props {
  jobId: string
  clips: EditorClip[]
  briefUrl: string | null
  podcastUrl: string | null
  onClose: () => void
}

export function ShareModal({ jobId, clips, briefUrl, podcastUrl, onClose }: Props) {
  const selected = clips.filter(c => c.selected)

  // ── Email state ──────────────────────────────────────────────────────────────
  const [emailTo, setEmailTo] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailResult, setEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

  const handleSendEmail = async () => {
    const addr = emailTo.trim()
    if (!addr) return
    setEmailSending(true)
    setEmailResult(null)
    try {
      const resp = await fetch(`/api/jobs/${jobId}/share/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: addr }),
      })
      const data = await resp.json() as { ok?: boolean; error?: string }
      if (data.ok) {
        setEmailResult({ ok: true, message: `Sent to ${addr}` })
        setEmailTo('')
      } else {
        setEmailResult({ ok: false, message: data.error ?? 'Send failed' })
      }
    } catch (err) {
      setEmailResult({ ok: false, message: (err as Error).message })
    } finally {
      setEmailSending(false)
    }
  }

  // ── Slack state ──────────────────────────────────────────────────────────────
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [sharing, setSharing] = useState<'brief' | 'podcast' | null>(null)
  const [shareResult, setShareResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    // Consume ?slack= query param left by the OAuth redirect
    const params = new URLSearchParams(window.location.search)
    const slackParam = params.get('slack')
    if (slackParam) {
      window.history.replaceState({}, '', window.location.pathname)
      if (slackParam === 'connected') setShareResult({ ok: true, message: 'Slack connected!' })
      if (slackParam === 'error') setShareResult({ ok: false, message: 'Slack connection failed — check your app credentials.' })
    }

    fetch('/api/slack/status')
      .then(r => r.json() as Promise<SlackStatus>)
      .then(data => {
        setSlackStatus(data)
        if (data.connected) {
          fetch('/api/slack/channels')
            .then(r => r.json() as Promise<{ channels: Channel[] }>)
            .then(d => {
              setChannels(d.channels ?? [])
              if (d.channels?.length) setSelectedChannel(d.channels[0].id)
            })
            .catch(() => {/* non-fatal */})
        }
      })
      .catch(() => setSlackStatus({ connected: false }))
  }, [])

  const handleDownloadAll = () => {
    selected.forEach(clip => {
      const a = document.createElement('a')
      a.href = `/api/output/${jobId}/clips/${clip.index}`
      a.download = `${clip.sceneLabel.replace(/\s+/g, '-').toLowerCase()}.mp4`
      a.click()
    })
  }

  const handleShare = async (type: 'brief' | 'podcast') => {
    if (!selectedChannel) return
    setSharing(type)
    setShareResult(null)
    try {
      const resp = await fetch(`/api/jobs/${jobId}/share/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannel }),
      })
      const data = await resp.json() as { ok?: boolean; error?: string }
      if (data.ok) {
        const ch = channels.find(c => c.id === selectedChannel)
        setShareResult({ ok: true, message: `Shared to #${ch?.name ?? selectedChannel}` })
      } else {
        setShareResult({ ok: false, message: data.error ?? 'Upload failed' })
      }
    } catch (err) {
      setShareResult({ ok: false, message: (err as Error).message })
    } finally {
      setSharing(null)
    }
  }

  const handleDisconnect = async () => {
    await fetch('/api/slack/disconnect', { method: 'DELETE' })
    setSlackStatus({ connected: false })
    setChannels([])
    setSelectedChannel('')
    setShareResult(null)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.title}>Share</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* ── Export clips ─────────────────────────────────────────────────── */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Export clips</div>
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
          {selected.length > 1 && (
            <button className={styles.downloadAllBtn} onClick={handleDownloadAll}>
              Download all ({selected.length})
            </button>
          )}
        </div>

        {/* ── Export brief / podcast ───────────────────────────────────────── */}
        {(briefUrl || podcastUrl) && (
          <>
            <div className={styles.divider} />
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Export</div>
              <ul className={styles.list}>
                {briefUrl && (
                  <li className={styles.item}>
                    <div>
                      <div className={styles.itemLabel}>Brief</div>
                      <div className={styles.itemMeta}>MP4 video</div>
                    </div>
                    <a href={briefUrl} download="brief.mp4" className={styles.downloadLink}>
                      Download
                    </a>
                  </li>
                )}
                {podcastUrl && (
                  <li className={styles.item}>
                    <div>
                      <div className={styles.itemLabel}>Podcast</div>
                      <div className={styles.itemMeta}>MP3 audio</div>
                    </div>
                    <a href={podcastUrl} download="podcast.mp3" className={styles.downloadLink}>
                      Download
                    </a>
                  </li>
                )}
              </ul>
            </div>
          </>
        )}

        {/* ── Share to Slack ───────────────────────────────────────────────── */}
        <div className={styles.divider} />
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Share to Slack</div>

          {slackStatus === null ? (
            <p className={styles.slackLoading}>Checking connection…</p>
          ) : !slackStatus.connected ? (
            <button className={styles.connectBtn} onClick={() => { localStorage.setItem('slack-return-url', window.location.href); window.location.href = '/api/slack/connect' }}>
              <SlackLogo />
              Connect Slack
            </button>
          ) : (
            <>
              <div className={styles.slackConnected}>
                <span className={styles.connectedDot} />
                <span className={styles.connectedText}>{slackStatus.workspace?.name ?? 'Connected'}</span>
                <button className={styles.disconnectBtn} onClick={handleDisconnect}>Disconnect</button>
              </div>

              {channels.length > 0 && (
                <select
                  className={styles.channelPicker}
                  value={selectedChannel}
                  onChange={e => setSelectedChannel(e.target.value)}
                >
                  {channels.map(c => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              )}

              <div className={styles.shareButtons}>
                <button
                  className={styles.shareBtn}
                  disabled={!briefUrl || !selectedChannel || sharing !== null}
                  onClick={() => handleShare('brief')}
                  title={briefUrl ? undefined : 'Generate a brief first'}
                >
                  {sharing === 'brief' ? 'Uploading…' : 'Share Brief'}
                </button>
                <button
                  className={styles.shareBtn}
                  disabled={!podcastUrl || !selectedChannel || sharing !== null}
                  onClick={() => handleShare('podcast')}
                  title={podcastUrl ? undefined : 'Generate a podcast first'}
                >
                  {sharing === 'podcast' ? 'Uploading…' : 'Share Podcast'}
                </button>
              </div>
            </>
          )}

          {shareResult && (
            <p className={shareResult.ok ? styles.shareSuccess : styles.shareError}>
              {shareResult.message}
            </p>
          )}
        </div>

        {/* ── Share via Email ───────────────────────────────────────────────── */}
        <div className={styles.divider} />
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Share via Email</div>
          <div className={styles.emailInputRow}>
            <input
              className={styles.emailInput}
              type="email"
              placeholder="recipient@example.com"
              value={emailTo}
              onChange={e => setEmailTo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendEmail()}
              disabled={emailSending}
            />
            <button
              className={styles.emailSendBtn}
              onClick={handleSendEmail}
              disabled={!emailTo.trim() || emailSending}
            >
              {emailSending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {emailResult && (
            <p className={emailResult.ok ? styles.shareSuccess : styles.shareError}>
              {emailResult.message}
            </p>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function SlackLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M19.712 33.36a4.44 4.44 0 0 1-4.44 4.44 4.44 4.44 0 0 1-4.44-4.44 4.44 4.44 0 0 1 4.44-4.44h4.44v4.44z" fill="#E01E5A"/>
      <path d="M22 33.36a4.44 4.44 0 0 1 4.44-4.44 4.44 4.44 0 0 1 4.44 4.44v11.12a4.44 4.44 0 0 1-4.44 4.44 4.44 4.44 0 0 1-4.44-4.44V33.36z" fill="#E01E5A"/>
      <path d="M26.44 19.712a4.44 4.44 0 0 1-4.44-4.44 4.44 4.44 0 0 1 4.44-4.44 4.44 4.44 0 0 1 4.44 4.44v4.44H26.44z" fill="#36C5F0"/>
      <path d="M26.44 22a4.44 4.44 0 0 1 4.44 4.44 4.44 4.44 0 0 1-4.44 4.44H15.32a4.44 4.44 0 0 1-4.44-4.44A4.44 4.44 0 0 1 15.32 22h11.12z" fill="#36C5F0"/>
      <path d="M40.088 26.44a4.44 4.44 0 0 1 4.44-4.44 4.44 4.44 0 0 1 4.44 4.44 4.44 4.44 0 0 1-4.44 4.44h-4.44V26.44z" fill="#2EB67D"/>
      <path d="M37.8 26.44a4.44 4.44 0 0 1-4.44 4.44 4.44 4.44 0 0 1-4.44-4.44V15.32a4.44 4.44 0 0 1 4.44-4.44 4.44 4.44 0 0 1 4.44 4.44V26.44z" fill="#2EB67D"/>
      <path d="M33.36 40.088a4.44 4.44 0 0 1 4.44 4.44 4.44 4.44 0 0 1-4.44 4.44 4.44 4.44 0 0 1-4.44-4.44v-4.44h4.44z" fill="#ECB22E"/>
      <path d="M33.36 37.8a4.44 4.44 0 0 1-4.44-4.44 4.44 4.44 0 0 1 4.44-4.44h11.12a4.44 4.44 0 0 1 4.44 4.44 4.44 4.44 0 0 1-4.44 4.44H33.36z" fill="#ECB22E"/>
    </svg>
  )
}
