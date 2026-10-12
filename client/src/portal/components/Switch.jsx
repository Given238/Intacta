/**
 * Switch — Material 3 style on/off switch (Figma "Switch" instances, e.g. 93:202 / 93:238).
 *   on:  green track (#109e34), white 24px handle on the right
 *   off: slate track with a light outline, small light handle on the left
 * size "md" = 52×32 (header switches), "sm" = 46×26 (row switches). The hit area is at least 44px tall.
 */
export default function Switch({ checked, onChange, label, size = 'md', disabled = false, id }) {
  const md = size === 'md'
  const track = md ? 'h-[32px] w-[52px]' : 'h-[26px] w-[46px]'
  const knobOn  = md ? 'h-[24px] w-[24px] translate-x-[24px]' : 'h-[20px] w-[20px] translate-x-[21px]'
  const knobOff = md ? 'h-[16px] w-[16px] translate-x-[8px]'  : 'h-[13px] w-[13px] translate-x-[7px]'

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] shrink-0 items-center disabled:opacity-50"
    >
      <span
        className={`relative flex items-center rounded-full border-2 transition-colors ${track}
                    ${checked ? 'border-[#109e34] bg-[#109e34]' : 'border-[#c6d6df] bg-[#466781]'}`}
      >
        <span
          className={`absolute left-0 rounded-full transition-transform ${checked ? `bg-white ${knobOn}` : `bg-[#c6d6df] ${knobOff}`}`}
          style={{ marginLeft: -2 }}
        />
      </span>
    </button>
  )
}
