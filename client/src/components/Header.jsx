/**
 * Header — teal bar of the terminal (Figma 1:2), fluid.
 *
 * Not paired:
 *   Wide (landscape, ≥900px): logo, "Intacta" wordmark + tagline on the left; on the right the two Baloo Da 2
 *   buttons "▶ Enable / caregiver connection" | "› Authentication code". Both open and close the same
 *   "Connect a caregiver" popup (code card, Figma 62:123) under the buttons; the first also requests a code
 *   when there is no valid one. Nothing here switches the screen to a caregiver view.
 *   Compact (portrait or <900px): logo + wordmark, one menu button that opens a popover with both actions;
 *   the connection card opens inside that popover.
 * Paired: the buttons, their divider and the menu are replaced (250 ms cross-fade) by a non-interactive chip
 *   "Connected · {name}" with a green dot ("{first name} +N" with several caregivers). A tap does nothing; holding it
 *   3 s calls onChipHold (the same popup with a fresh code, so another caregiver can pair).
 * Holding the logo for 3 s (touch or mouse) calls onLogoHold; there is no visible switch button. The two holds are
 * separate elements with separate timers.
 * CSS in terminal.css (.term-header*, .term-swap, .term-chip); sizes scale with the header height.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'
import logoSvg from '../assets/logo.svg'
import ConnectCard from './ConnectCard'
import { useLongPress } from '../hooks/useLongPress'
import { chipText } from '../lib/connection'

// Play triangle (Figma 62:119)
function PlayTriangle({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 3.5L17 10L5 16.5V3.5Z" fill="white" />
    </svg>
  )
}

// Chevron (Figma 58:2)
function ChevronIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 4L12 10L7 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "Connected · {name}": shows state only; the 3 s hold is the hidden way to add a caregiver. */
export function ConnectedChip({ connection, onHold }) {
  const { t } = useTranslation()
  const hold = useLongPress(onHold)
  const { main, more, full } = chipText(t, connection)
  return (
    <div className="term-chip" role="status" aria-label={full} title={t('connected.holdHint')} data-testid="connected-chip" {...hold}>
      <span className="term-chip-dot" aria-hidden="true" />
      <span className="term-chip-text" aria-hidden="true">{main}</span>
      {more && <span className="term-chip-more" aria-hidden="true">{more}</span>}
    </div>
  )
}

export default function Header({
  connection = { paired: false }, // {paired, name, count} (lib/connection)
  showPopup,         // the "Connect a caregiver" popup (wide: under the buttons; compact: in the menu; paired: under the chip)
  onAuthCode,        // toggles the popup
  onEnableConnection, // toggles the popup and requests a code when there is no valid one
  onClosePopup,
  pairingCode,
  pairingExpiresAt,
  onRegenerate,
  regLoading,
  onLogoHold,        // patient screen: holding the logo 3 s opens "Switch mode?" (a tap does nothing)
  onChipHold,        // paired: holding the chip 3 s opens the popup with a fresh code
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef(null)
  const hold = useLongPress(onLogoHold)
  const paired = !!connection.paired
  const shownChip = useRef(connection)
  if (paired) shownChip.current = connection

  // The compact menu belongs to the unpaired header
  useEffect(() => { if (paired) setMenuOpen(false) }, [paired])

  // Close the compact menu and the popup on an outside tap or Escape
  useEffect(() => {
    if (!menuOpen && !showPopup) return
    const close = () => { setMenuOpen(false); onClosePopup?.() }
    const onDown = (e) => { if (!rowRef.current?.contains(e.target)) close() }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, showPopup, onClosePopup])

  const toggleMenu = () => {
    if (menuOpen) onClosePopup?.()
    setMenuOpen(o => !o)
  }

  const card = (
    <ConnectCard code={pairingCode} expiresAt={pairingExpiresAt} loading={regLoading} onRegenerate={onRegenerate} />
  )
  const popover = (
    <div id="term-connect" className="term-popover" role="dialog" aria-label={t('connect.title')}>
      {card}
    </div>
  )

  return (
    <header className="term-header" data-paired={paired ? 'true' : 'false'}>
      <div className="term-header-row" ref={rowRef}>
        {/* Logo (node 31:4) + wordmark */}
        <img src={logoSvg} alt="" className="term-logo" draggable={false} {...hold} />
        <div className="term-brand">
          <span className="term-wordmark">{t('brand')}</span>
          <span className="term-tagline">{t('tagline')}</span>
        </div>

        {/* Right side: the connect actions (not paired) and the chip (paired) cross-fade in one grid cell */}
        <div className="term-swap">
          <div
            className={`term-swap-layer term-unpaired${paired ? ' is-hidden' : ''}`}
            aria-hidden={paired ? 'true' : undefined}
            inert={paired ? true : undefined}
            data-testid="connect-actions"
          >
            {/* ── Wide: the two Figma buttons, both open the same popup ── */}
            <div className="term-actions">
              <button
                type="button"
                className="term-action"
                onClick={onEnableConnection}
                aria-expanded={!!showPopup}
                aria-controls="term-connect"
                aria-label={`${t('enable')} ${t('caregiverConnection')}`}
              >
                <PlayTriangle />
                <span className="term-action-lines">
                  <span className="light">{t('enable')}</span>
                  <span>{t('caregiverConnection')}</span>
                </span>
              </button>
              <span className="term-divider" aria-hidden="true" />
              <button
                type="button"
                className="term-action"
                onClick={onAuthCode}
                aria-expanded={!!showPopup}
                aria-controls="term-connect"
                aria-label={t('authCode')}
              >
                <ChevronIcon />
                {t('authCode')}
              </button>
              {showPopup && !paired && popover}
            </div>

            {/* ── Compact: one menu ── */}
            <button
              type="button"
              className="term-menu-btn"
              onClick={toggleMenu}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t('menu')}
            >
              {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
              <span>{t('menu')}</span>
            </button>
          </div>

          <div
            className={`term-swap-layer term-paired${paired ? '' : ' is-hidden'}`}
            aria-hidden={paired ? undefined : 'true'}
            inert={paired ? undefined : true}
          >
            {/* the last paired state stays rendered while it fades out after an unpair */}
            {shownChip.current.paired && <ConnectedChip connection={shownChip.current} onHold={paired ? onChipHold : undefined} />}
          </div>

          {showPopup && paired && popover}
        </div>

        {menuOpen && !paired && (
          <div className="term-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="term-menu-item"
              aria-expanded={!!showPopup}
              onClick={onEnableConnection}
            >
              <PlayTriangle /> {t('enable')} {t('caregiverConnection')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="term-menu-item"
              aria-expanded={!!showPopup}
              onClick={onAuthCode}
            >
              <ChevronIcon /> {t('authCode')}
            </button>
            {showPopup && (
              <div className="px-[12px] pb-[8px]" role="group" aria-label={t('connect.title')}>
                {card}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
