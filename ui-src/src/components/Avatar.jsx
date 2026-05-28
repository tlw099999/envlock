import { hashColor } from '../utils.js'

const SIZES = { sm: 22, md: 28, lg: 36 }

export default function Avatar({ name, size = 'sm' }) {
  const px     = SIZES[size] ?? SIZES.sm
  const bg     = hashColor(name ?? '?')
  const letter = (name ?? '?')[0]?.toUpperCase() ?? '?'
  const fs     = Math.round(px * 0.44)

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: '50%',
        background: bg,
        color: '#07080D',
        fontSize: fs,
        fontWeight: '800',
        flexShrink: 0,
        userSelect: 'none',
        lineHeight: 1,
        letterSpacing: '-0.5px',
      }}
      title={name}
    >
      {letter}
    </span>
  )
}
