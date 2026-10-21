/**
 * PortalToast — same look as the terminal's error toast (pages/Home.jsx).
 */
import { AlertCircle } from 'lucide-react'

export default function PortalToast({ message }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="fixed left-1/2 -translate-x-1/2 flex items-center gap-[10px] w-max max-w-[calc(100%-32px)]
                 rounded-control bg-[#dc2626] px-5 py-3 text-body font-semibold text-white
                 shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
      style={{ top: 'calc(env(safe-area-inset-top) + 88px)', zIndex: 45 }}
    >
      <AlertCircle size={22} className="shrink-0" />
      {message}
    </div>
  )
}
