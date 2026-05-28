import { PackagePlus } from 'lucide-react'
import s from './Empty.module.css'

export default function Empty({ title, subtitle, code }) {
  return (
    <div className={s.empty}>
      <div className={s.icon}>
        <PackagePlus size={22} />
      </div>
      <p className={s.title}>{title}</p>
      {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      {code && (
        <div className={s.codeWrap}>
          <code className={s.code}>{code}</code>
        </div>
      )}
    </div>
  )
}
