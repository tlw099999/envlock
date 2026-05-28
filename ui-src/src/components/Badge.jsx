const STYLES = {
  manage: {
    background: 'var(--manage-bg)',
    color:      'var(--manage)',
    border:     '1px solid rgba(167, 139, 250, 0.25)',
  },
  write: {
    background: 'var(--write-bg)',
    color:      'var(--write)',
    border:     '1px solid rgba(252, 211, 77, 0.25)',
  },
  read: {
    background: 'var(--read-bg)',
    color:      'var(--read)',
    border:     '1px solid rgba(52, 211, 153, 0.25)',
  },
}

const DOT_COLORS = {
  manage: 'var(--manage)',
  write:  'var(--write)',
  read:   'var(--read)',
}

export default function Badge({ level }) {
  if (!level) {
    return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
  }

  const style = STYLES[level] ?? {
    background: 'var(--surface)',
    color:      'var(--text-dim)',
    border:     '1px solid var(--border)',
  }
  const dotColor = DOT_COLORS[level] ?? 'var(--text-muted)'

  return (
    <span
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '5px',
        padding:       '2px 8px 2px 6px',
        borderRadius:  '99px',
        fontSize:      '11px',
        fontWeight:    '600',
        letterSpacing: '0.3px',
        whiteSpace:    'nowrap',
        ...style,
      }}
    >
      <span style={{
        width:        '5px',
        height:       '5px',
        borderRadius: '50%',
        background:   dotColor,
        flexShrink:   0,
      }} />
      {level}
    </span>
  )
}
