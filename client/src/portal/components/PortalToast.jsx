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
                 rounded-[14px] bg-[#dc2626] px-5 py-[10px] text-body-medium text-[18px] text-white
                 shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
      style={{ top: 'calc(env(safe-area-inset-top) + 125px)', zIndex: 25 }}
    >
      <AlertCircle size={22} className="shrink-0" />
      {message}
    </div>
  )
}
