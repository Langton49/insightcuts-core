import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useJobPoller } from '../hooks/useJobPoller'
import { ProcessingScreen } from '../components/ProcessingScreen'
import { loadSavedProject } from './WorkspacePage'
import type { JobResponse } from '../api/client'

export type StepState = 'pending' | 'active' | 'complete'

// Which job phase each step belongs to
const STEP_PHASE = [
  'detecting',   // 0 Indexing video
  'detecting',   // 1 Finding clips
] as const

const TOTAL_STEPS = STEP_PHASE.length

function buildInitialSteps(): StepState[] {
  return STEP_PHASE.map((_, i) => (i === 0 ? 'active' : 'pending'))
}

// Max step index allowed for a given job status
function maxStepForStatus(status: string): number {
  if (status === 'detecting') return 1
  if (status === 'complete' || status === 'error') return 1
  return 0
}

export function ProcessingPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const { state } = useLocation()
  const navigate = useNavigate()

  const projectName: string =
    (state as { projectName?: string } | null)?.projectName ??
    loadSavedProject()?.name ??
    'Your project'

  const [steps, setSteps] = useState<StepState[]>(buildInitialSteps)
  const jobStatusRef = useRef<string>('detecting')
  const completingRef = useRef(false)

  // Advance to the next step freely (no ceiling — backend polling handles phase sync)
  const advanceStep = useCallback(() => {
    setSteps(prev => {
      const activeIdx = prev.findIndex(s => s === 'active')
      if (activeIdx === -1) return prev

      const next = [...prev]
      next[activeIdx] = 'complete'
      const nextIdx = activeIdx + 1
      if (nextIdx < TOTAL_STEPS) next[nextIdx] = 'active'
      return next
    })
  }, [])

  // Timer advances steps every 5s
  useEffect(() => {
    const id = setInterval(advanceStep, 5000)
    return () => clearInterval(id)
  }, [advanceStep])

  // Navigation is driven exclusively by backend job status (handleJobUpdate below).
  // The step timer is visual-only — do not navigate based on timer completion alone.

  // Handle job status updates from polling
  const handleJobUpdate = useCallback(
    (job: JobResponse) => {
      jobStatusRef.current = job.status

      if ((job.status === 'review' || job.status === 'complete' || job.status === 'error') && !completingRef.current) {
        completingRef.current = true
        // Rapidly complete remaining detecting steps then navigate to editor
        let delay = 0
        const detectingSteps = 2 // steps 0-1 are detecting
        setSteps(prev => {
          const next = [...prev]
          for (let i = 0; i < detectingSteps; i++) {
            if (next[i] !== 'complete') {
              delay += 400
              setTimeout(() => {
                setSteps(p => {
                  const n = [...p]
                  n[i] = 'complete'
                  return n
                })
              }, delay)
            }
          }
          return next
        })
        setTimeout(() => {
          navigate(`/editor/${jobId ?? 'done'}`, { state: { projectName } })
        }, delay + 600)
      }
    },
    [jobId, navigate, projectName],
  )

  useJobPoller(jobId ?? null, handleJobUpdate)

  return <ProcessingScreen steps={steps} projectName={projectName} />
}
