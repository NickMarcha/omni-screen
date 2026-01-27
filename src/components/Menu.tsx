import { useState, useEffect, useCallback } from 'react'
import yeeCharmGif from '../assets/media/YeeCharm.gif'
import abaGrinchPng from '../assets/media/AbaGrinch.png'
import achshullyRetardedPng from '../assets/media/ACHshullyRetarded.png'
import bennyLovePng from '../assets/media/BennyLove.png'
import donaldSmadgePng from '../assets/media/DonaldSmadge.png'
import mehdiAwarePng from '../assets/media/mehdiAware.png'
import manHoldsCatPng from '../assets/media/ManHoldsCat.png'
import noHopePng from '../assets/media/NoHope.png'
import whickedSteinPng from '../assets/media/WhickedStein.png'

interface MenuProps {
  onNavigate: (page: 'link-scroller' | 'omni-screen') => void
}

function Menu({ onNavigate }: MenuProps) {
  // Random icon for Link Scroller
  const linkScrollerIcons = [
    abaGrinchPng,
    achshullyRetardedPng,
    bennyLovePng,
    donaldSmadgePng,
    mehdiAwarePng,
    manHoldsCatPng,
    noHopePng,
    whickedSteinPng
  ]
  const [randomIcon] = useState(() => 
    linkScrollerIcons[Math.floor(Math.random() * linkScrollerIcons.length)]
  )

  // Update UI state
  const [checking, setChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [versionInfo, setVersionInfo] = useState<any>()
  const [updateError, setUpdateError] = useState<any>()
  const [progressInfo, setProgressInfo] = useState<any>()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalBtn, setModalBtn] = useState({
    cancelText: 'Close',
    okText: 'Update',
    onCancel: () => setModalOpen(false),
    onOk: () => window.ipcRenderer.invoke('start-download'),
  })

  const checkUpdate = async () => {
    setChecking(true)
    const result = await window.ipcRenderer.invoke('check-update')
    setProgressInfo({ percent: 0 })
    setChecking(false)
    setModalOpen(true)
    if (result?.error) {
      setUpdateAvailable(false)
      setUpdateError(result?.error)
    }
  }

  const onUpdateCanAvailable = useCallback((_event: any, arg1: any) => {
    setVersionInfo(arg1)
    setUpdateError(undefined)
    if (arg1.update) {
      setModalBtn(state => ({
        ...state,
        cancelText: 'Cancel',
        okText: 'Update',
        onOk: () => window.ipcRenderer.invoke('start-download'),
      }))
      setUpdateAvailable(true)
    } else {
      setUpdateAvailable(false)
    }
  }, [])

  const onUpdateError = useCallback((_event: any, arg1: any) => {
    setUpdateAvailable(false)
    setUpdateError(arg1)
  }, [])

  const onDownloadProgress = useCallback((_event: any, arg1: any) => {
    setProgressInfo(arg1)
  }, [])

  const onUpdateDownloaded = useCallback((_event: any) => {
    setProgressInfo({ percent: 100 })
    setModalBtn(state => ({
      ...state,
      cancelText: 'Later',
      okText: 'Install now',
      onOk: () => window.ipcRenderer.invoke('quit-and-install'),
    }))
  }, [])

  useEffect(() => {
    window.ipcRenderer.on('update-can-available', onUpdateCanAvailable)
    window.ipcRenderer.on('update-error', onUpdateError)
    window.ipcRenderer.on('download-progress', onDownloadProgress)
    window.ipcRenderer.on('update-downloaded', onUpdateDownloaded)
    return () => {
      window.ipcRenderer.off('update-can-available', onUpdateCanAvailable)
      window.ipcRenderer.off('update-error', onUpdateError)
      window.ipcRenderer.off('download-progress', onDownloadProgress)
      window.ipcRenderer.off('update-downloaded', onUpdateDownloaded)
    }
  }, [onUpdateCanAvailable, onUpdateError, onDownloadProgress, onUpdateDownloaded])

  return (
    <div className="min-h-screen bg-base-100 text-base-content flex flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold text-center mb-2 text-primary flex items-center justify-center gap-3">
        <img src={yeeCharmGif} alt="" className="w-12 h-12 object-contain" />
        Omni Screen
        <img src={yeeCharmGif} alt="" className="w-12 h-12 object-contain" />
      </h1>
      <p className="text-base-content/60 text-sm mb-12">Vibed by StrawWaffle</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full mb-8">
        {/* Link Scroller - Active */}
        <button
          className="card bg-base-200 shadow-xl p-8 hover:shadow-2xl transition-shadow cursor-pointer"
          onClick={() => onNavigate('link-scroller')}
        >
          <div className="card-body flex-row items-center gap-6">
            <img src={randomIcon} alt="" className="w-32 h-32 object-contain flex-shrink-0" />
            <div className="flex flex-col text-left">
              <h2 className="card-title text-2xl mb-2">Link Scroller</h2>
              <p className="text-base-content/70">
                Browse and filter messages with embedded media from various platforms
              </p>
            </div>
          </div>
        </button>

        {/* Omni Screen - Disabled */}
        <button
          className="card bg-base-200 shadow-xl p-8 hover:shadow-2xl transition-shadow cursor-pointer"
          onClick={() => onNavigate('omni-screen')}
        >
          <div className="card-body items-center text-center">
            <h2 className="card-title text-2xl mb-4">Omni Screen</h2>
            <p className="text-base-content/70">
              Split-screen embeds + live chat
            </p>
          </div>
        </button>
      </div>

      {/* Update Button */}
      <div className="card bg-base-200 shadow-xl p-6 max-w-md w-full">
        <button 
          className="btn btn-secondary w-full" 
          disabled={checking} 
          onClick={checkUpdate}
        >
          {checking ? 'Checking...' : 'Check for Updates'}
        </button>
      </div>

      {/* Update Modal */}
      {modalOpen && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-300 text-base-content max-w-md">
            <h3 className="font-bold text-lg mb-4">Update Status</h3>
            <div className="mb-4">
              {updateError ? (
                <div>
                  <p className="text-error mb-2">Error downloading the latest version.</p>
                  <p className="text-error text-sm">{updateError.message}</p>
                </div>
              ) : updateAvailable ? (
                <div>
                  <div className="text-success mb-2">The latest version is: v{versionInfo?.newVersion}</div>
                  <div className="text-base-content/70 text-sm mb-4">Current: v{versionInfo?.version} → v{versionInfo?.newVersion}</div>
                  <div className="mb-4">
                    <div className="text-sm mb-2">Update progress:</div>
                    <div className="bg-base-200 rounded-full h-4 w-full overflow-hidden">
                      <div 
                        className="bg-success h-full transition-all duration-300" 
                        style={{width: `${progressInfo?.percent||0}%`}}
                      ></div>
                    </div>
                    <div className="text-xs mt-2 text-base-content/70">{progressInfo?.percent ? `${progressInfo.percent.toFixed(1)}%` : '0%'}</div>
                  </div>
                </div>
              ) : (
                <div className="text-base-content/50">
                  No update available.<br/>
                  <pre className="text-xs mt-2 bg-base-200 p-2 rounded overflow-auto">
                    {JSON.stringify(versionInfo ?? {}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn btn-outline" onClick={modalBtn.onCancel}>
                {modalBtn.cancelText||'Close'}
              </button>
              {updateAvailable && (
                <button className="btn btn-primary" onClick={modalBtn.onOk}>
                  {modalBtn.okText||'Update'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Menu
