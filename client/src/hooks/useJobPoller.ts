import { useEffect, useRef, useCallback } from 'react'
import { getJob, type JobResponse } from '../api/client'

const DEFAULT_TERMINAL = new Set(['review', 'complete', 'error'])

export function useJobPoller(
  jobId: string | null,
  onUpdate: (job: JobResponse) => void,
  intervalMs = 2000,
  terminalStatuses: Set<string> = DEFAULT_TERMINAL,
) {
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!jobId) return

    const poll = async () => {
      try {
        const job = await getJob(jobId)
        onUpdateRef.current(job)
        if (terminalStatuses.has(job.status)) {
          stop()
        }
      } catch (err) {
        // Transient errors (network blip, server restart) — keep polling
        console.warn('[useJobPoller] poll error, will retry:', err)
      }
    }

    poll() // immediate first call
    timerRef.current = setInterval(poll, intervalMs)

    return stop
  }, [jobId, intervalMs, stop, terminalStatuses])
}
