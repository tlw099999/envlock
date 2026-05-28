import { useEffect } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import s from './Toast.module.css'

function ToastItem({ toast, onRemove }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, onRemove])

  const isError = toast.type === 'error'

  return (
    <div className={`${s.toast} ${isError ? s.toastError : s.toastSuccess}`}>
      <span className={s.icon}>
        {isError
          ? <AlertCircle size={14} />
          : <CheckCircle2 size={14} />
        }
      </span>
      <span className={s.message}>{toast.message}</span>
      <button className={s.close} onClick={() => onRemove(toast.id)}>
        <X size={12} />
      </button>
    </div>
  )
}

export default function Toast({ toasts, onRemove }) {
  if (!toasts.length) return null
  return (
    <div className={s.container}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}
