import { useState, useEffect, useCallback } from 'react'
import { fetchData } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import EnvView from './components/EnvView.jsx'
import MembersView from './components/MembersView.jsx'
import Toast from './components/Toast.jsx'
import s from './App.module.css'

let toastId = 0

export default function App() {
  const [data,      setData]      = useState(null)
  const [activeTab, setActiveTab] = useState(null)
  const [toasts,    setToasts]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const loadData = useCallback(async (isRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchData()
      setData(result)
      setActiveTab(prev => {
        if (!prev || (!result.envs?.includes(prev) && prev !== '__members__')) {
          return result.envs?.[0] ?? '__members__'
        }
        return prev
      })
      if (isRefresh) addToast('Refreshed', 'success')
    } catch (err) {
      setError(err.message)
      if (isRefresh) addToast(`Refresh failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { loadData(false) }, [])

  // Loading
  if (loading && !data) {
    return (
      <div className={s.loadingScreen}>
        {/* ambient glow */}
        <div className={s.loadingGlow} />

        {/* spinner ring + icon */}
        <div className={s.spinnerWrap}>
          <div className={s.spinnerRing} />
          <svg className={s.loadingIcon} viewBox="0 0 200 200" fill="none">
            <defs>
              <linearGradient id="lbg" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#5B41E0"/>
                <stop offset="100%" stopColor="#9070FF"/>
              </linearGradient>
              <linearGradient id="lshine" x1="100" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="white" stopOpacity="0.13"/>
                <stop offset="100%" stopColor="white" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <rect width="200" height="200" rx="46" fill="url(#lbg)"/>
            <rect width="200" height="100" rx="46" fill="url(#lshine)"/>
            <path d="M71 114 L71 87 A29 29 0 0 1 129 87 L129 114"
              stroke="white" strokeWidth="15" strokeLinecap="round" fill="none" strokeOpacity="0.97"/>
            <rect x="49" y="112" width="102" height="66" rx="14" fill="white" fillOpacity="0.96"/>
            <circle cx="100" cy="139" r="11.5" fill="url(#lbg)"/>
            <rect x="95.5" y="145" width="9" height="14" rx="3.5" fill="url(#lbg)"/>
          </svg>
        </div>

        {/* wordmark */}
        <div className={s.loadingWordmark}>envlock</div>
        <div className={s.loadingStatus}>loading your workspace…</div>

        {/* indeterminate progress bar */}
        <div className={s.progressBar}>
          <div className={s.progressFill} />
        </div>
      </div>
    )
  }

  // Error
  if (error && !data) {
    return (
      <div className={s.errorScreen}>
        <p className={s.errorTitle}>Failed to load</p>
        <p className={s.errorMessage}>{error}</p>
        <button className={s.retryBtn} onClick={() => loadData(false)}>Try again</button>
      </div>
    )
  }

  const refresh = () => loadData(true)

  return (
    <div className={s.shell}>
      <Sidebar
        project={data?.project}
        identity={data?.identity}
        envs={data?.envs ?? []}
        envsData={data?.envsData ?? {}}
        allMembers={data?.allMembers ?? []}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={refresh}
        loading={loading}
      />

      <main className={s.main}>
        {activeTab === '__members__' ? (
          <MembersView
            allMembers={data?.allMembers ?? []}
            envs={data?.envs ?? []}
            identity={data?.identity}
            onRefresh={refresh}
            addToast={addToast}
          />
        ) : (
          <EnvView
            env={activeTab}
            envData={data?.envsData?.[activeTab]}
            allMembers={data?.allMembers ?? []}
            identity={data?.identity}
            onRefresh={refresh}
            addToast={addToast}
          />
        )}
      </main>

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  )
}
