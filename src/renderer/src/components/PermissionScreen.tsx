import { Shield } from 'lucide-react'

export function PermissionScreen(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] px-8">
      <div className="w-16 h-16 rounded-2xl bg-[#1c1c1c] flex items-center justify-center mb-6">
        <Shield className="w-8 h-8 text-blue-500" />
      </div>
      <h1 className="text-2xl font-semibold text-white mb-2">Full Disk Access Required</h1>
      <p className="text-[#a3a3a3] text-center max-w-md mb-8 leading-relaxed">
        Stash needs access to your Messages database to index your attachments.
        This stays on your Mac — nothing is uploaded anywhere.
      </p>
      <div className="bg-[#141414] rounded-xl border border-[#262626] p-6 max-w-md w-full">
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1c1c1c] text-blue-500 flex items-center justify-center text-xs font-medium">1</span>
            <span className="text-[#a3a3a3]">Open <span className="text-white font-medium">System Settings</span></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1c1c1c] text-blue-500 flex items-center justify-center text-xs font-medium">2</span>
            <span className="text-[#a3a3a3]">Go to <span className="text-white font-medium">Privacy & Security</span></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1c1c1c] text-blue-500 flex items-center justify-center text-xs font-medium">3</span>
            <span className="text-[#a3a3a3]">Click <span className="text-white font-medium">Full Disk Access</span></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1c1c1c] text-blue-500 flex items-center justify-center text-xs font-medium">4</span>
            <span className="text-[#a3a3a3]">Enable <span className="text-white font-medium">Stash</span></span>
          </li>
        </ol>
      </div>
      <p className="text-xs text-[#636363] mt-6">
        Stash will automatically continue once access is granted.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-xs text-[#636363]">Waiting for permission...</span>
      </div>
    </div>
  )
}
