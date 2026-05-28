import { RefreshCw, Users } from 'lucide-react'
import { hashColor } from '../utils.js'
import s from './Sidebar.module.css'

function EnvDot({ level }) {
  const color = level === 'manage' ? 'var(--manage)'
              : level === 'write'  ? 'var(--write)'
              : level === 'read'   ? 'var(--read)'
              : 'var(--text-muted)'
  return <span className={s.envDot} style={{ background: color }} />
}

export default function Sidebar({
  project, identity, envs, envsData, allMembers,
  activeTab, onTabChange, onRefresh, loading,
}) {
  const fp      = identity?.fingerprint ?? ''
  const fpShort = fp.slice(0, 8)
  const me      = identity?.name ?? ''
  const bg      = hashColor(me)

  const totalMembers = allMembers?.length ?? 0

  return (
    <aside className={s.sidebar}>
      {/* Logo */}
      <div className={s.brand}>
        <div className={s.logo}>
          <svg width="22" height="22" viewBox="0 0 200 200" fill="none">
            <defs>
              <linearGradient id="sbg" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#5B41E0"/>
                <stop offset="100%" stopColor="#9070FF"/>
              </linearGradient>
            </defs>
            <rect width="200" height="200" rx="46" fill="url(#sbg)"/>
            <path d="M71 114 L71 87 A29 29 0 0 1 129 87 L129 114"
              stroke="white" strokeWidth="15" strokeLinecap="round" fill="none" strokeOpacity="0.97"/>
            <rect x="49" y="112" width="102" height="66" rx="14" fill="white" fillOpacity="0.96"/>
            <circle cx="100" cy="139" r="11.5" fill="url(#sbg)"/>
            <rect x="95.5" y="145" width="9" height="14" rx="3.5" fill="url(#sbg)"/>
          </svg>
          <span className={s.wordmark}>envlock</span>
        </div>
        {project && <span className={s.project}>{project}</span>}
      </div>

      {/* Nav */}
      <nav className={s.nav}>
        {/* Environments section */}
        {envs.length > 0 && (
          <>
            <div className={s.navSection}>Environments</div>
            {envs.map(env => {
              const ed = envsData?.[env]
              const isActive = activeTab === env
              return (
                <button
                  key={env}
                  className={`${s.navItem} ${isActive ? s.active : ''}`}
                  onClick={() => onTabChange(env)}
                >
                  <EnvDot level={ed?.myLevel} />
                  <span className={s.navLabel}>{env}</span>
                  {ed?.varCount > 0 && (
                    <span className={`${s.navBadge} ${isActive ? s.navBadgeActive : ''}`}>
                      {ed.varCount}
                    </span>
                  )}
                </button>
              )
            })}
          </>
        )}

        {/* Team section */}
        <div className={s.navSection} style={{ marginTop: 8 }}>Team</div>
        <button
          className={`${s.navItem} ${activeTab === '__members__' ? s.active : ''}`}
          onClick={() => onTabChange('__members__')}
        >
          <Users size={13} className={s.navIcon} />
          <span className={s.navLabel}>Members</span>
          {totalMembers > 0 && (
            <span className={`${s.navBadge} ${activeTab === '__members__' ? s.navBadgeActive : ''}`}>
              {totalMembers}
            </span>
          )}
        </button>
      </nav>

      {/* Footer */}
      <div className={s.footer}>
        <button
          className={s.refreshBtn}
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? s.spinning : ''} />
          <span>Refresh</span>
        </button>

        {identity && (
          <div className={s.identity}>
            <span className={s.avatar} style={{ background: bg }}>
              {me[0]?.toUpperCase() ?? '?'}
            </span>
            <div className={s.identityInfo}>
              <span className={s.identityName}>{me}</span>
              <span className={s.identityFp}>{fpShort}</span>
            </div>
            <span className={s.onlineDot} />
          </div>
        )}
      </div>
    </aside>
  )
}
