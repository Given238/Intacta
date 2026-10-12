/**
 * Header — teal bar across the top of the 1194×834 stage.
 *
 * Layout within the 1194×834 stage:
 *   Logo:   left 34, top 24,  50×67 px
 *   Brand:  left 117, top 7,   Baloo Da 2 ExtraBold 52px white
 *   Tag:    left 119, top 76,  Inter Medium 20px #c6d6df
 *
 * Right-side buttons (absolute, within stage):
 *   Caregiver mode:  left 635, top 24 — play triangle + "Enter" / "Caregiver mode" (2 lines)
 *   Divider:         x=862, y=24, 1×77px white
 *   Auth code:       left 900, top 30 — chevron + "Authentication code"
 *
 * Popup card (62:123): position 908,96, 229×188, shown when showPopup=true
 */
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import logoSvg from '../assets/logo.svg'

// Play triangle SVG (matches Figma node 62:119)
function PlayTriangle({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 3.5L17 10L5 16.5V3.5Z" fill="white" />
    </svg>
  )
}

// Chevron SVG (matches Figma node 58:2)
function ChevronIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 4L12 10L7 16"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Header({
  language,
  showPopup,       // auth-code popup
  onAuthCode,      // toggle popup
  pairingCode,     // for popup
  onEnterCaregiver,
  regLoading,
}) {
  const { t } = useTranslation()

  return (
    <>
      {/* ── Header bar ───────────────────────────────────────── */}
      <header
        style={{
          position:   'absolute',
          left:       0,
          top:        0,
          width:      1194,
          height:     125,
          background: '#05668d',
          zIndex:     15,
        }}
      >
        {/* Logo (node 31:4) */}
        <img
          src={logoSvg}
          alt="Intacta"
          style={{
            position: 'absolute',
            left:     34,
            top:      24,
            width:    50,
            height:   67,
          }}
        />

        {/* Brand name */}
        <span
          style={{
            position:     'absolute',
            left:         117,
            top:          7,
            fontFamily:   '"Baloo Da 2", cursive',
            fontSize:     52,
            fontWeight:   800,
            color:        'white',
            lineHeight:   1,
            letterSpacing: '-0.01em',
          }}
        >
          {t('brand')}
        </span>

        {/* Tagline */}
        <span
          style={{
            position:   'absolute',
            left:       119,
            top:        76,
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize:   20,
            fontWeight:  500,
            color:      '#c6d6df',
            lineHeight: 1,
          }}
        >
          {t('tagline')}
        </span>

        {/* ── Right-side buttons ── */}

        {/* Caregiver mode button — ONE button: triangle + 2 text lines */}
        <button
          onClick={onEnterCaregiver}
          disabled={regLoading}
          style={{
            position:   'absolute',
            left:       635,
            top:        24,
            display:    'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap:        2,
            background: 'transparent',
            border:     'none',
            cursor:     regLoading ? 'wait' : 'pointer',
            padding:    0,
            opacity:    regLoading ? 0.7 : 1,
            zIndex:     16,
          }}
          aria-label={t('caregiverMode')}
        >
          {/* Row: play triangle + "Enter" */}
          <span
            style={{
              display:     'flex',
              alignItems:  'center',
              gap:         6,
              fontFamily:  '"Baloo Da 2", cursive',
              fontSize:    25,
              fontWeight:  400,
              color:       'white',
              lineHeight:  1,
            }}
          >
            <PlayTriangle size={18} />
            {t('enter')}
          </span>
          {/* "Caregiver mode" */}
          <span
            style={{
              fontFamily:  '"Baloo Da 2", cursive',
              fontSize:    25,
              fontWeight:  800,
              color:       'white',
              lineHeight:  1,
              marginLeft:  24, // offset to align under "Enter" (after triangle)
            }}
          >
            {t('caregiverMode')}
          </span>
        </button>

        {/* Divider line — 1px white, x=862, y=24, height=77 */}
        <div
          style={{
            position:   'absolute',
            left:       862,
            top:        24,
            width:      1,
            height:     77,
            background: 'rgba(255,255,255,0.5)',
          }}
        />

        {/* Auth code button — chevron + "Authentication code" */}
        <button
          onClick={onAuthCode}
          style={{
            position:    'absolute',
            left:        900,
            top:         30,
            display:     'flex',
            alignItems:  'center',
            gap:         6,
            background:  'transparent',
            border:      'none',
            cursor:      'pointer',
            padding:     0,
            zIndex:      16,
          }}
          aria-label={t('authCode')}
        >
          <ChevronIcon size={18} />
          <span
            style={{
              fontFamily:  '"Baloo Da 2", cursive',
              fontSize:    25,
              fontWeight:  800,
              color:       'white',
              lineHeight:  1,
            }}
          >
            {t('authCode')}
          </span>
        </button>
      </header>

      {/* ── Auth code popup card (62:123) ─────────────────────── */}
      {/* Shown at position 908,96 within the stage; z-index above everything */}
      {showPopup && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t('thisIsYourCode')}
          style={{
            position:   'absolute',
            left:       908,
            top:        96,
            width:      229,
            height:     188,
            background: '#137ba6',
            borderRadius: 16,
            display:    'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap:        10,
            padding:    16,
            boxShadow:  '0 8px 32px rgba(0,0,0,0.4)',
            zIndex:     20,
          }}
        >
          <p
            style={{
              fontFamily:  '"Baloo Da 2", cursive',
              fontSize:    18,
              fontWeight:  500,
              color:       'white',
              textAlign:   'center',
              margin:      0,
            }}
          >
            {t('thisIsYourCode')}
          </p>

          {/* Dark code pill */}
          <div
            style={{
              background:  '#234053',
              borderRadius: 12,
              width:        '100%',
              height:       68,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                fontFamily:    '"Inter", system-ui, sans-serif',
                fontSize:      32,
                fontWeight:    800,
                color:         'white',
                letterSpacing: '0.06em',
              }}
            >
              {pairingCode || '------'}
            </span>
          </div>

          <p
            style={{
              fontFamily:  '"Inter", system-ui, sans-serif',
              fontSize:    13,
              fontWeight:  400,
              color:       'rgba(255,255,255,0.75)',
              textAlign:   'center',
              margin:      0,
            }}
          >
            {t('useThisToConnect')}
          </p>
        </div>
      )}
    </>
  )
}
