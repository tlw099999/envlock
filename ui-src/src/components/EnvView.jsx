import { useState, useRef } from 'react'
import {
  Plus, Eye, EyeOff, Trash2, Pencil, Check, X,
  RefreshCw, ChevronRight, Lock, Copy,
} from 'lucide-react'
import Badge from './Badge.jsx'
import Avatar from './Avatar.jsx'
import Empty from './Empty.jsx'
import Modal, { ModalActions, DangerBtn, GhostBtn, PrimaryBtn } from './Modal.jsx'
import { relativeTime, resolveAuthor } from '../utils.js'
import { apiPost, apiDelete, apiPut } from '../api.js'
import s from './EnvView.module.css'

// ── Reveal cell ───────────────────────────────────────────────────────────────

function RevealCell({ env, varKey }) {
  const [state, setState] = useState('idle') // idle | loading | shown | error
  const [value, setValue] = useState('')
  const [err,   setErr]   = useState('')
  const timerRef          = useRef(null)

  async function handleReveal() {
    if (state === 'shown') {
      clearTimeout(timerRef.current)
      setState('idle')
      setValue('')
      return
    }
    setState('loading')
    try {
      const { value: v } = await apiPost('/api/reveal', { env, key: varKey })
      setValue(v)
      setState('shown')
      timerRef.current = setTimeout(() => {
        setState('idle')
        setValue('')
      }, 12000)
    } catch (e) {
      setErr(e.message)
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  if (state === 'shown') {
    return (
      <div className={s.revealShown}>
        <code className={s.revealValue}>{value}</code>
        <button className={s.revealClose} onClick={handleReveal} title="Hide">
          <EyeOff size={12} />
        </button>
      </div>
    )
  }
  if (state === 'error') {
    return <span className={s.revealError}>{err}</span>
  }

  return null
}

// ── Variable row ──────────────────────────────────────────────────────────────

function VarRow({ v, env, allMembers, canWrite, onDelete, onUpdate }) {
  const [editing,  setEditing]  = useState(false)
  const [editVal,  setEditVal]  = useState('')
  const [revState, setRevState] = useState('idle') // idle | loading | shown | error
  const [revealed, setRevealed] = useState('')
  const [revErr,   setRevErr]   = useState('')
  const [copied,   setCopied]   = useState(false)
  const [delModal, setDelModal] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const revTimer               = useRef(null)

  const authorName = resolveAuthor(v.by, allMembers)

  // ── reveal ──
  async function handleReveal() {
    if (revState === 'shown') {
      clearTimeout(revTimer.current)
      setRevState('idle')
      setRevealed('')
      return
    }
    setRevState('loading')
    try {
      const { value } = await apiPost('/api/reveal', { env, key: v.key })
      setRevealed(value)
      setRevState('shown')
      revTimer.current = setTimeout(() => {
        setRevState('idle')
        setRevealed('')
      }, 12000)
    } catch (e) {
      setRevErr(e.message)
      setRevState('error')
      setTimeout(() => setRevState('idle'), 3000)
    }
  }

  // ── copy ──
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(revealed)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      // silently ignore
    }
  }

  // ── inline edit ──
  function startEdit() {
    setEditVal('')
    setEditing(true)
  }
  async function saveEdit() {
    if (!editVal.trim()) { setEditing(false); return }
    setSaving(true)
    try {
      await apiPut('/api/vars', { env, key: v.key, value: editVal })
      onUpdate()
    } catch (e) {
      onUpdate() // refresh anyway
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  // ── delete ──
  async function confirmDelete() {
    setDeleting(true)
    try {
      await apiDelete('/api/vars', { env, key: v.key })
      onDelete()
    } catch (e) {
      // surface via refresh
      onDelete()
    } finally {
      setDeleting(false)
      setDelModal(false)
    }
  }

  return (
    <>
      <div className={s.varRow}>
        <div className={s.varMain}>
          <Lock size={12} className={s.keyIcon} />
          <span className={s.keyName}>{v.key}</span>
        </div>

        {/* Reveal area */}
        {revState === 'shown' && (
          <div className={s.revealShown}>
            <code className={s.revealValue}>{revealed}</code>
            <button
              className={`${s.revealAction} ${copied ? s.revealActionCopied : ''}`}
              onClick={handleCopy}
              title={copied ? 'Copied!' : 'Copy to clipboard'}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            <button className={s.revealClose} onClick={handleReveal} title="Hide">
              <EyeOff size={11} />
            </button>
          </div>
        )}
        {revState === 'error' && (
          <span className={s.revealError}>{revErr}</span>
        )}

        {/* Edit area */}
        {editing ? (
          <div className={s.editRow}>
            <input
              className={s.editInput}
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              placeholder="new value"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') saveEdit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <button className={s.editSave} onClick={saveEdit} disabled={saving} title="Save">
              <Check size={13} />
            </button>
            <button className={s.editCancel} onClick={() => setEditing(false)} title="Cancel">
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className={s.varMeta}>
            <div className={s.authorCell}>
              <Avatar name={authorName} size="sm" />
              <span className={s.authorName}>{authorName}</span>
            </div>
            <span className={s.timeCell}>{relativeTime(v.at)}</span>
          </div>
        )}

        {/* Actions — always visible but styled subtly */}
        {!editing && (
          <div className={s.varActions}>
            <button
              className={`${s.actionBtn} ${revState === 'shown' ? s.actionBtnActive : ''}`}
              onClick={handleReveal}
              disabled={revState === 'loading'}
              title={revState === 'shown' ? 'Hide' : 'Reveal value'}
            >
              {revState === 'loading' ? <RefreshCw size={13} className={s.spin} />
               : revState === 'shown' ? <EyeOff size={13} />
               : <Eye size={13} />}
            </button>
            {canWrite && (
              <>
                <button className={s.actionBtn} onClick={startEdit} title="Edit value">
                  <Pencil size={13} />
                </button>
                <button
                  className={`${s.actionBtn} ${s.actionBtnDanger}`}
                  onClick={() => setDelModal(true)}
                  title="Delete variable"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {delModal && (
        <Modal title="Delete variable" onClose={() => setDelModal(false)} width={380}>
          <p className={s.confirmText}>
            Delete <code className={s.confirmKey}>{v.key}</code> from{' '}
            <strong>{env}</strong>?
          </p>
          <p className={s.confirmSub}>This removes the encrypted blobs for all members.</p>
          <ModalActions>
            <GhostBtn onClick={() => setDelModal(false)}>Cancel</GhostBtn>
            <DangerBtn onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </DangerBtn>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}

// ── Add variable drawer ───────────────────────────────────────────────────────

function AddVarModal({ env, onClose, onAdded }) {
  const [key,       setKey]       = useState('')
  const [value,     setValue]     = useState('')
  const [showValue, setShowValue] = useState(false)
  const [err,       setErr]       = useState('')
  const [busy,      setBusy]      = useState(false)

  async function handleAdd() {
    const k = key.trim()
    const v = value.trim()
    if (!k) { setErr('Key is required'); return }
    if (!v) { setErr('Value is required'); return }
    setBusy(true)
    setErr('')
    try {
      await apiPost('/api/vars', { env, key: k, value: v })
      onAdded()
      onClose()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Add variable to ${env}`} onClose={onClose}>
      <div className={s.formGroup}>
        <label className={s.label}>Key</label>
        <input
          className={s.input}
          placeholder="DATABASE_URL"
          value={key}
          onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
      </div>
      <div className={s.formGroup}>
        <label className={s.label}>Value</label>
        <div className={s.inputWrap}>
          <input
            className={s.inputWithToggle}
            type={showValue ? 'text' : 'password'}
            placeholder={showValue ? 'enter value' : '•••••••••'}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className={s.eyeToggle}
            type="button"
            onClick={() => setShowValue(v => !v)}
            title={showValue ? 'Hide value' : 'Show value'}
            tabIndex={-1}
          >
            {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      {err && <p className={s.formError}>{err}</p>}
      <ModalActions>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={handleAdd} disabled={busy}>
          {busy ? 'Encrypting…' : 'Add variable'}
        </PrimaryBtn>
      </ModalActions>
    </Modal>
  )
}

// ── Coverage badge ────────────────────────────────────────────────────────────

function Coverage({ blobCount, totalVars }) {
  if (totalVars === 0) return <span className={s.coverageNa}>—</span>
  if (blobCount === totalVars) return (
    <span className={s.coverageOk}>{blobCount}/{totalVars}</span>
  )
  if (blobCount === 0) return (
    <span className={s.coverageMissing}>0/{totalVars}</span>
  )
  return <span className={s.coveragePartial}>{blobCount}/{totalVars}</span>
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EnvView({ env, envData, allMembers, identity, onRefresh, addToast }) {
  const [showAddVar, setShowAddVar] = useState(false)

  if (!envData) return null

  const { myLevel, varCount, memberCount, vars, members } = envData
  const canWrite = myLevel === 'write' || myLevel === 'manage'

  return (
    <div className={s.page}>
      {/* Page header */}
      <div className={s.pageHead}>
        <div className={s.pageHeadLeft}>
          <h1 className={s.pageTitle}>{env}</h1>
          <Badge level={myLevel} />
        </div>
        {canWrite && (
          <button className={s.addBtn} onClick={() => setShowAddVar(true)}>
            <Plus size={14} />
            Add variable
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className={s.statsRow}>
        <div className={s.stat}>
          <span className={s.statNum}>{varCount}</span>
          <span className={s.statLabel}>variable{varCount !== 1 ? 's' : ''}</span>
        </div>
        <div className={s.statDivider} />
        <div className={s.stat}>
          <span className={s.statNum}>{memberCount}</span>
          <span className={s.statLabel}>member{memberCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Variables section */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Variables</h2>

        {vars.length === 0 ? (
          <Empty
            title="No variables yet"
            subtitle={canWrite ? 'Click "Add variable" to add your first secret.' : 'No secrets have been added yet.'}
            code={`envlock add KEY=VALUE --env ${env}`}
          />
        ) : (
          <div className={s.varList}>
            {vars.map(v => (
              <VarRow
                key={v.key}
                v={v}
                env={env}
                allMembers={allMembers}
                canWrite={canWrite}
                onDelete={() => { addToast(`${v.key} deleted`); onRefresh() }}
                onUpdate={() => { addToast(`${v.key} updated`); onRefresh() }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Members section */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Members with access</h2>

        {members.length === 0 ? (
          <Empty
            title="No members yet"
            subtitle="Grant team members access to this environment."
            code={`envlock add-member <name> --env ${env} --access read`}
          />
        ) : (
          <div className={s.memberList}>
            {members.map(m => {
              const isMe = m.fingerprint === identity?.fingerprint
              return (
                <div key={m.fingerprint} className={s.memberRow}>
                  <Avatar name={m.name} size="md" />
                  <div className={s.memberInfo}>
                    <span className={s.memberName}>
                      {m.name}
                      {isMe && <span className={s.youTag}>you</span>}
                    </span>
                    <span className={s.memberFp}>{m.fingerprint?.slice(0, 10)}…</span>
                  </div>
                  <Badge level={m.level} />
                  <Coverage blobCount={m.blobCount} totalVars={m.totalVars} />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {showAddVar && (
        <AddVarModal
          env={env}
          onClose={() => setShowAddVar(false)}
          onAdded={() => { addToast('Variable added & encrypted for all members'); onRefresh() }}
        />
      )}
    </div>
  )
}
