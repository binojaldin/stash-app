import type { IndexingProgress } from '../types'

interface Props {
  progress: IndexingProgress
}

export function IndexingOverlay({ progress }: Props): JSX.Element {
  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0
  const remaining = progress.total - progress.processed
  const avgTimePerItem = 0.15 // seconds estimate
  const etaSeconds = Math.round(remaining * avgTimePerItem)
  const etaMinutes = Math.floor(etaSeconds / 60)
  const etaSecondsRemainder = etaSeconds % 60

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-sm flex items-center justify-center">
      <div className="max-w-lg w-full px-8">
        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold text-white mb-2">Indexing your attachments</h2>
          <p className="text-sm text-[#a3a3a3]">
            This only happens once. You can start browsing while we finish.
          </p>
        </div>

        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-[#a3a3a3]">{progress.processed.toLocaleString()} of {progress.total.toLocaleString()}</span>
            <span className="text-white font-medium">{percent}%</span>
          </div>
          <div className="h-2 bg-[#1c1c1c] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {progress.currentFile && (
          <p className="text-xs text-[#636363] truncate mb-2">
            {progress.currentFile}
          </p>
        )}

        {progress.processed > 0 && remaining > 0 && (
          <p className="text-xs text-[#636363]">
            ~{etaMinutes > 0 ? `${etaMinutes}m ` : ''}{etaSecondsRemainder}s remaining
          </p>
        )}

        <button
          onClick={() => {
            const overlay = document.querySelector('[data-indexing-overlay]')
            if (overlay) (overlay as HTMLElement).style.display = 'none'
          }}
          className="mt-6 w-full py-2 rounded-lg bg-[#1c1c1c] text-sm text-[#a3a3a3] hover:bg-[#262626] hover:text-white transition-colors"
          data-indexing-overlay
        >
          Browse while indexing
        </button>
      </div>
    </div>
  )
}
