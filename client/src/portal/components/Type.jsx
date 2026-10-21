/**
 * Type — the portal's only text primitives (C1). Sizes, weights and line-heights come from the theme tokens in
 * index.css (text-title / text-card / text-body / text-secondary / text-caption); never use ad-hoc text-[13px].
 *
 *   <Heading level="screen|card" as="h1|h2|h3">   22-26 / 700  ·  16-18 / 600
 *   <Text tone="body|secondary" muted>            15-16 / 400  ·  13-14 / 400 (muted = white 80%, cards only)
 *   <Label htmlFor>                               12 / 500, form labels
 *   <Caption>                                     12 / 500, tags, hints, counters
 * Max 3 text sizes per card.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ')

export function Heading({ level = 'card', as, className = '', ...props }) {
  const Tag = as || (level === 'screen' ? 'h1' : 'h2')
  return <Tag className={cx(level === 'screen' ? 'text-title' : 'text-card', className)} {...props} />
}

export function Text({ tone = 'body', muted = false, as: Tag = 'p', className = '', ...props }) {
  return <Tag className={cx(tone === 'secondary' ? 'text-secondary' : 'text-body', muted && 'text-muted', className)} {...props} />
}

export function Label({ className = '', ...props }) {
  // eslint-disable-next-line jsx-a11y/label-has-associated-control
  return <label className={cx('text-caption mb-2 block text-muted', className)} {...props} />
}

export function Caption({ as: Tag = 'span', className = '', ...props }) {
  return <Tag className={cx('text-caption', className)} {...props} />
}
