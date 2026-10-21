/**
 * Header — teal bar of the terminal (Figma 1:2), fluid.
 *
 * Wide (landscape, ≥900px): logo, "Intacta" wordmark + tagline on the left; on the right the two Baloo Da 2
 * buttons "▶ Enter / Caregiver mode" | "› Authentication code", the code card (62:123) opens under the second.
 * Compact (portrait or <900px): logo + wordmark, one menu button that opens a popover with both actions;
 * "Authentication code" shows the code inside the popover.
 * CSS in terminal.css (.term-header*); sizes scale with the header height.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'
import logoSvg from '../assets/logo.svg'

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

function CodeCard({ pairingCode }) {
  const { t } = useTranslation()
  return (
    <>
      <p className="term-popover-title">{t('thisIsYourCode')}</p>
      <div className="term-code-pill">{pairingCode || '------'}</div>
      <p className="term-popover-note">{t('useThisToConnect')}</p>
    </>
  )
}

export default function Header({
  showPopup,       // code card (wide layout)
  onAuthCode,      // toggles the code card / opens the pairing screen
  pairingCode,
  onEnterCaregiver,
  regLoading,
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuCode, setMenuCode] = useState(false)
  const menuRef = useRef(null)

  // Close the compact menu on an outside tap or Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const toggleMenu = () => { setMenuCode(false); setMenuOpen(o => !o) }

  return (
    <header className="term-header">
      <div className="term-header-row" ref={menuRef}>
        {/* Logo (node 31:4) + wordmark */}
        <img src={logoSvg} alt="" className="term-logo" />
        <div className="term-brand">
          <span className="term-wordmark">{t('brand')}</span>
          <span className="term-tagline">{t('tagline')}</span>
        </div>

        {/* ── Wide: the two Figma buttons ── */}
        <div className="term-actions">
          <button type="button" className="term-action" onClick={onEnterCaregiver} disabled={regLoading} aria-label={t('caregiverMode')}>
            <PlayTriangle />
            <span className="term-action-lines">
              <span className="light">{t('enter')}</span>
              <span>{t('caregiverMode')}</span>
            </span>
          </button>
          <span className="term-divider" aria-hidden="true" />
          <div style={{ position: 'relative' }}>
            <button type="button" className="term-action" onClick={onAuthCode} aria-expanded={!!showPopup} aria-label={t('authCode')}>
              <ChevronIcon />
              {t('authCode')}
            </button>
            {showPopup && (
              <div className="term-popover" role="dialog" aria-label={t('thisIsYourCode')}>
                <CodeCard pairingCode={pairingCode} />
              </div>
            )}
          </div>
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
        {menuOpen && (
          <div className="term-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="term-menu-item"
              disabled={regLoading}
              onClick={() => { setMenuOpen(false); onEnterCaregiver?.() }}
            >
              <PlayTriangle /> {t('caregiverMode')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="term-menu-item"
              aria-expanded={menuCode}
              onClick={() => (pairingCode ? (setMenuOpen(false), onAuthCode?.()) : setMenuCode(c => !c))}
            >
              <ChevronIcon /> {t('authCode')}
            </button>
            {menuCode && (
              <div className="px-[12px] pb-[8px]">
                <CodeCard pairingCode={pairingCode} />
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
