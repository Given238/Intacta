/**
 * TabBar — bottom navigation for /portal/* (not in Figma; built from the header tokens).
 * 64px + safe-area-inset-bottom, five ≥44px targets, active tab on the header teal.
 */
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { TAB_BAR_HEIGHT } from '../layout'
import { House, UserRound, CalendarClock, NotebookText, Settings } from 'lucide-react'

const TABS = [
  { to: '/portal',          key: 'home',     Icon: House,         end: true },
  { to: '/portal/patient',  key: 'patient',  Icon: UserRound },
  { to: '/portal/routines', key: 'routines', Icon: CalendarClock },
  { to: '/portal/context',  key: 'context',  Icon: NotebookText },
  { to: '/portal/settings', key: 'settings', Icon: Settings },
]

/* Text fields open the phone keyboard; sliders, switches and buttons don't */
const NO_KEYBOARD = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'])
const opensKeyboard = (el) =>
  el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !NO_KEYBOARD.has(el.type)) || el?.isContentEditable

/* True while a text field is focused, so the bar can step aside for the keyboard */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const update = () => setOpen(opensKeyboard(document.activeElement))
    const onFocusIn = (e) => {
      update()
      // keep the focused field visible above the keyboard once it has opened
      if (opensKeyboard(e.target)) setTimeout(() => e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300)
    }
    const onFocusOut = () => setTimeout(update, 0)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return open
}

export default function TabBar() {
  const { t } = useTranslation()
  const keyboardOpen = useKeyboardOpen()
  if (keyboardOpen) return null

  return (
    <nav
      aria-label={t('portal.tabs.label')}
      className="fixed bottom-0 left-1/2 z-20 w-full max-w-[480px] -translate-x-1/2 bg-intacta-panel shadow-[0_-2px_9px_rgba(6,19,44,0.25)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch gap-1 px-2" style={{ height: TAB_BAR_HEIGHT }}>
        {TABS.map(({ to, key, Icon, end }) => (
          <li key={key} className="flex flex-1 py-[6px]">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-[44px] w-full flex-col items-center justify-center gap-[2px] rounded-[10px] text-title-semibold text-[12px]
                 ${isActive ? 'bg-intacta-dark text-white' : 'text-intacta-text'}`
              }
            >
              <Icon size={22} aria-hidden="true" />
              {t(`portal.tabs.${key}`)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
