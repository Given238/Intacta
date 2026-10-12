/**
 * Pairing — waiting for caregiver screen.
 * Renders inside TerminalStage (1194×834 coordinate space).
 * App.jsx wraps it with TerminalStage + MeshBackground + Header.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import WaveformBars from '../components/WaveformBars'

export default function Pairing({ code, language, onRegenerate, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!code) navigate('/terminal', { replace: true })
  }, [code, navigate])

  if (!code) return null

  return (
    <>
      {/* Waveform — Figma positions, stage coordinates */}
      <WaveformBars />

      {/* Greeting text */}
      <p
        style={{
          position:  'absolute',
          left:      271,
          top:       610,
          width:     703,
          textAlign: 'center',
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize:  40,
          fontWeight: 800,
          color:     'white',
          lineHeight: 1.2,
          margin:    0,
        }}
      >
        {t('greeting')}
      </p>

      {/* ── Pairing code panel (right side, ~x=908, y=96, 229×188) ── */}
      <div
        style={{
          position:  'absolute',
          right:     57,
          top:       96,
          width:     229,
          background:'#137ba6',
          borderRadius: 16,
          display:   'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding:   '14px 16px',
          gap:       8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex:    20,
        }}
        role="alertdialog"
        aria-label={t('thisIsYourCode')}
      >
        <p
          style={{
            fontFamily: '"Baloo Da 2", cursive',
            fontSize:   22,
            fontWeight: 800,
            color:      'white',
            margin:     0,
          }}
        >
          {t('authCode')}
        </p>
        <p
          style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize:   17,
            fontWeight: 500,
            color:      'rgba(255,255,255,0.85)',
            margin:     0,
          }}
        >
          {t('thisIsYourCode')}
        </p>

        {/* Code box — dark pill */}
        <div
          style={{
            background:   '#234053',
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
            {code}
          </span>
        </div>

        <p
          style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize:   13,
            fontWeight: 400,
            color:      'rgba(255,255,255,0.75)',
            textAlign:  'center',
            margin:     0,
          }}
        >
          {t('useThisToConnect')}
        </p>

        {/* Regenerate link */}
        <button
          onClick={onRegenerate}
          style={{
            background:  'transparent',
            border:      'none',
            color:       'rgba(255,255,255,0.6)',
            fontFamily:  '"Inter", system-ui, sans-serif',
            fontSize:    13,
            cursor:      'pointer',
            textDecoration: 'underline',
            padding:     0,
            marginTop:   2,
          }}
        >
          Regenerate
        </button>
      </div>

      {/* Dismiss hint */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate('/terminal')}
        onKeyDown={e => e.key === 'Enter' && navigate('/terminal')}
        style={{
          position: 'absolute',
          bottom:   30,
          left:     '50%',
          transform:'translateX(-50%)',
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize: 14,
          color:    'rgba(255,255,255,0.4)',
          cursor:   'pointer',
        }}
      >
        {t('tapToClose')}
      </div>
    </>
  )
}
