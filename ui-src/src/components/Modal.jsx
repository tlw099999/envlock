import { useEffect } from 'react'
import { X } from 'lucide-react'
import s from './Modal.module.css'

export default function Modal({ title, children, onClose, width = 440 }) {
  // Close on Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        className={s.panel}
        style={{ maxWidth: width }}
        onClick={e => e.stopPropagation()}
      >
        <div className={s.header}>
          <span className={s.title}>{title}</span>
          <button className={s.closeBtn} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  )
}

/** A pre-styled confirm + cancel row */
export function ModalActions({ children }) {
  return <div className={s.actions}>{children}</div>
}

/** Danger confirm button */
export function DangerBtn({ onClick, disabled, children }) {
  return (
    <button className={s.dangerBtn} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

/** Primary action button */
export function PrimaryBtn({ onClick, disabled, children }) {
  return (
    <button className={s.primaryBtn} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

/** Secondary / ghost button */
export function GhostBtn({ onClick, disabled, children }) {
  return (
    <button className={s.ghostBtn} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
