import { useState } from 'react'
import { RotateCcw, Trash2, Plus, Terminal } from 'lucide-react'
import Badge from './Badge.jsx'
import Avatar from './Avatar.jsx'
import Empty from './Empty.jsx'
import Modal, { ModalActions, DangerBtn, GhostBtn, PrimaryBtn } from './Modal.jsx'
import { apiDelete, apiPost } from '../api.js'
import s from './MembersView.module.css'

// ── Grant modal ───────────────────────────────────────────────────────────────

function GrantModal({ member, env, onClose, onGranted }) {
  const [access, setAccess] = useState('read')
  const [syncAfter, setSyncAfter] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [err,  setErr]      = useState('')

  async function handleGrant() {
    setBusy(true)
    setErr('')
    try {
      await apiPost('/api/members/grant', {
        targetName: member.name,
        env,
        access,
        syncAfter,
      })
      onGranted(`${member.name} granted ${access} on ${env}${syncAfter ? ' (synced)' : ''}`)
      onClose()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Grant access — ${member.name}`} onClose={onClose} width={400}>
      <p className={s.modalText}>
        Grant <strong>{member.name}</strong> access to <strong>{env}</strong>
      </p>

      <div className={s.formGroup}>
        <label className={s.label}>Access level</label>
        <div className={s.accessPicker}>
          {['read', 'write', 'manage'].map(lvl => (
            <button
              key={lvl}
              className={`${s.accessOption} ${access === lvl ? s.accessOptionActive : ''}`}
              onClick={() => setAccess(lvl)}
              type="button"
            >
              <span className={s.accessDot} data-level={lvl} />
              <span className={s.accessLabel}>{lvl}</span>
              <span className={s.accessDesc}>
                {lvl === 'read'   && 'decrypt only'}
                {lvl === 'write'  && 'add & update vars'}
                {lvl === 'manage' && 'full control'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className={s.checkRow}>
        <input
          type="checkbox"
          className={s.checkbox}
          checked={syncAfter}
          onChange={e => setSyncAfter(e.target.checked)}
        />
        <span>Sync vars now <span className={s.checkHint}>(encrypts all current vars for them)</span></span>
      </label>

      {err && <p className={s.formError}>{err}</p>}

      <ModalActions>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={handleGrant} disabled={busy}>
          {busy ? 'Granting…' : 'Grant access'}
        </PrimaryBtn>
      </ModalActions>
    </Modal>
  )
}

// ── Member card ───────────────────────────────────────────────────────────────

function MemberCard({ member, envs, identity, onRefresh, addToast }) {
  const [syncModal, setSyncModal] = useState(false)
  const [revokeEnv, setRevokeEnv] = useState(null)   // env | 'all'
  const [grantEnv,  setGrantEnv]  = useState(null)   // env
  const [busy,      setBusy]      = useState(false)

  const isMe     = member.fingerprint === identity?.fingerprint
  const fp       = member.fingerprint ?? ''
  const fpShort  = fp.slice(0, 8) + '…' + fp.slice(-4)
  const hasAccess = Object.values(member.envAccess ?? {}).some(v => v != null)

  // ── sync ──
  async function handleSync() {
    setBusy(true)
    try {
      const { syncedEnvs } = await apiPost('/api/members/sync', { targetName: member.name })
      addToast(syncedEnvs.length > 0
        ? `Synced ${member.name}: ${syncedEnvs.join(', ')}`
        : `Nothing to sync for ${member.name}`, 'success')
      onRefresh()
    } catch (e) {
      addToast(`Sync failed: ${e.message}`, 'error')
    } finally {
      setBusy(false)
      setSyncModal(false)
    }
  }

  // ── revoke ──
  async function handleRevoke() {
    const targetEnvs = revokeEnv === 'all'
      ? envs.filter(e => member.envAccess?.[e])
      : [revokeEnv]
    setBusy(true)
    try {
      await apiDelete('/api/members/grant', { targetName: member.name, envs: targetEnvs })
      addToast(`${member.name} revoked from ${targetEnvs.join(', ')}`, 'success')
      onRefresh()
    } catch (e) {
      addToast(`Revoke failed: ${e.message}`, 'error')
    } finally {
      setBusy(false)
      setRevokeEnv(null)
    }
  }

  return (
    <>
      <div className={s.card}>
        <div className={s.cardTop}>
          <Avatar name={member.name} size="lg" />
          <div className={s.cardInfo}>
            <div className={s.cardName}>
              {member.name}
              {isMe && <span className={s.youTag}>you</span>}
              {!hasAccess && !isMe && <span className={s.pendingTag}>no access</span>}
            </div>
            <div className={s.cardFp}>{fpShort}</div>
          </div>
          {!isMe && hasAccess && (
            <div className={s.cardActions}>
              <button
                className={s.iconBtn}
                onClick={() => setSyncModal(true)}
                title="Sync vars"
                disabled={busy}
              >
                <RotateCcw size={13} />
              </button>
              <button
                className={`${s.iconBtn} ${s.iconBtnDanger}`}
                onClick={() => setRevokeEnv('all')}
                title="Revoke all access"
                disabled={busy}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Per-env access chips */}
        <div className={s.envGrid}>
          {envs.map(env => {
            const level = member.envAccess?.[env] ?? null
            return (
              <div
                key={env}
                className={`${s.envChip} ${level ? s.envChipActive : ''}`}
              >
                <span className={s.envChipName}>{env}</span>

                {level
                  ? <Badge level={level} />
                  : <span className={s.envChipNone}>no access</span>
                }

                {/* Grant button — shown on hover when no access and not self */}
                {!isMe && !level && (
                  <button
                    className={s.grantChipBtn}
                    onClick={() => setGrantEnv(env)}
                    title={`Grant ${member.name} access to ${env}`}
                    disabled={busy}
                  >
                    <Plus size={10} />
                  </button>
                )}

                {/* Revoke button — shown on hover when has access and not self */}
                {!isMe && level && (
                  <button
                    className={s.revokeChipBtn}
                    onClick={() => setRevokeEnv(env)}
                    title={`Revoke ${env} access`}
                    disabled={busy}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Grant modal */}
      {grantEnv && (
        <GrantModal
          member={member}
          env={grantEnv}
          onClose={() => setGrantEnv(null)}
          onGranted={msg => { addToast(msg, 'success'); onRefresh() }}
        />
      )}

      {/* Sync confirm */}
      {syncModal && (
        <Modal title={`Sync ${member.name}`} onClose={() => setSyncModal(false)} width={380}>
          <p className={s.modalText}>
            Re-encrypt all variables for <strong>{member.name}</strong> across every
            environment where you have manage access.
          </p>
          <ModalActions>
            <GhostBtn onClick={() => setSyncModal(false)}>Cancel</GhostBtn>
            <PrimaryBtn onClick={handleSync} disabled={busy}>
              {busy ? 'Syncing…' : 'Sync now'}
            </PrimaryBtn>
          </ModalActions>
        </Modal>
      )}

      {/* Revoke confirm */}
      {revokeEnv && (
        <Modal
          title={`Revoke access${revokeEnv === 'all' ? ' (all envs)' : ''}`}
          onClose={() => setRevokeEnv(null)}
          width={380}
        >
          <p className={s.modalText}>
            {revokeEnv === 'all'
              ? <>Remove <strong>{member.name}</strong>'s access from all environments?</>
              : <>Remove <strong>{member.name}</strong>'s access from <strong>{revokeEnv}</strong>?</>
            }
          </p>
          <p className={s.modalSub}>
            Their existing .env files still work until they pull the latest commit.
          </p>
          <ModalActions>
            <GhostBtn onClick={() => setRevokeEnv(null)}>Cancel</GhostBtn>
            <DangerBtn onClick={handleRevoke} disabled={busy}>
              {busy ? 'Revoking…' : 'Revoke access'}
            </DangerBtn>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MembersView({ allMembers, envs, identity, onRefresh, addToast }) {
  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <h1 className={s.pageTitle}>Members</h1>
        <span className={s.countBadge}>{allMembers?.length ?? 0}</span>
      </div>

      <p className={s.pageSub}>
        {allMembers?.length ?? 0} member{(allMembers?.length ?? 0) !== 1 ? 's' : ''} across{' '}
        {envs?.length ?? 0} environment{(envs?.length ?? 0) !== 1 ? 's' : ''}
      </p>

      {!allMembers || allMembers.length === 0 ? (
        <Empty
          title="No members yet"
          subtitle="Members appear here after they run envlock join in this repo."
          code="envlock join"
        />
      ) : (
        <>
          <div className={s.grid}>
            {allMembers.map(member => (
              <MemberCard
                key={member.fingerprint}
                member={member}
                envs={envs ?? []}
                identity={identity}
                onRefresh={onRefresh}
                addToast={addToast}
              />
            ))}
          </div>

          {/* Invite hint */}
          <div className={s.inviteHint}>
            <Terminal size={13} className={s.inviteIcon} />
            <span>
              New teammate? Ask them to run{' '}
              <code className={s.inviteCode}>envlock join</code>{' '}
              in this repo — they'll appear here and you can grant access.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
