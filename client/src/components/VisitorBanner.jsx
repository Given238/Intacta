/**
 * VisitorBanner — shown when daily_context has visitor_name + arrival_time.
 * Inside TerminalStage: uses absolute pixel coordinates (1194×834 stage).
 */
import { useTranslation } from 'react-i18next'

export default function VisitorBanner({ context, language }) {
  const { t } = useTranslation()

  if (!context?.visitor_name) return null

  return (
    <div
      style={{
        position:   'absolute',
        left:       347, // center in 1194 stage: (1194 - 500) / 2
        top:        130,
        width:      500,
        background: 'rgba(5,102,141,0.88)',
        borderRadius: 20,
        padding:    '12px 24px',
        textAlign:  'center',
        zIndex:     12,
      }}
      role="status"
    >
      <p
        style={{
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize:   22,
          fontWeight: 600,
          color:      'white',
          margin:     0,
          lineHeight: 1.2,
        }}
      >
        {t('visitorComing')}
      </p>
      <p
        style={{
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize:   32,
          fontWeight: 800,
          color:      'white',
          margin:     '4px 0 0',
          lineHeight: 1.2,
        }}
      >
        {t('visitorName', { name: context.visitor_name })}
      </p>
      {context.arrival_time && (
        <p
          style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize:   18,
            fontWeight: 500,
            color:      'rgba(255,255,255,0.8)',
            margin:     '4px 0 0',
            lineHeight: 1.2,
          }}
        >
          {t('arrivingAt', { time: context.arrival_time })}
        </p>
      )}
    </div>
  )
}
