import { useState, useEffect } from 'react'
import './App.css'

type LogEntry = {
  msg: string;
  type: 'info' | 'success' | 'error';
  timestamp: string;
}

function App() {
  const [activeTab, setActiveTab] = useState<'solve' | 'settings' | 'logs'>('solve')
  const [model, setModel] = useState('llama3')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([
    { msg: 'System initialized and ready', type: 'info', timestamp: new Date().toLocaleTimeString() }
  ])
  const [loading, setLoading] = useState(false)

  // Load settings and fetch models on mount
  useEffect(() => {
    chrome.storage.local.get(['model', 'autoAdvance'], (result) => {
      if (typeof result.model === 'string') setModel(result.model)
      if (typeof result.autoAdvance === 'boolean') setAutoAdvance(result.autoAdvance)
    })

    chrome.runtime.sendMessage({ action: 'fetchModels' }, (response) => {
      if (response?.success && response.models) {
        const names = response.models.map((m: any) => m.name)
        setAvailableModels(names)
        if (names.length > 0 && !names.includes(model)) {
          setModel(names[0])
        }
      } else {
        addLog('Could not fetch Ollama models', 'error')
      }
    })
  }, [])

  // Save settings when they change
  useEffect(() => {
    chrome.storage.local.set({ model, autoAdvance })
  }, [model, autoAdvance])

  const addLog = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    const newEntry: LogEntry = {
      msg,
      type,
      timestamp: new Date().toLocaleTimeString()
    }
    setLogs(prev => [newEntry, ...prev].slice(0, 50))
  }

  const handleSolve = async () => {
    setLoading(true)
    addLog('Analyzing page content...', 'info')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        addLog('No active tab detected', 'error')
        return
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'solveQuiz',
        model,
        autoAdvance
      })

      if (response.success) {
        addLog(`Successfully identified: ${response.answer}`, 'success')
      } else {
        addLog(response.message || 'Page scanning failed', 'error')
      }
    } catch (err) {
      addLog('Communication error with script', 'error')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleAutomation = async (type: 'autoCourse' | 'stop') => {
    setLoading(true)
    addLog(`Initiating ${type === 'autoCourse' ? 'course automation' : 'stop signal'}...`, 'info')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        addLog('No active tab detected', 'error')
        return
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: type,
        model
      })

      if (response.success) {
        addLog(response.message || 'Automation sequence started', 'success')
      } else {
        addLog(response.message || 'Automation failed to start', 'error')
      }
    } catch (err) {
      addLog('Communication error with script', 'error')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <header className="header">
        <h1>FLASH<span style={{ color: 'var(--primary)' }}> COURSE AI</span></h1>
        <div className="nav-tabs">
          <div
            className={`nav-tab ${activeTab === 'solve' ? 'active' : ''}`}
            onClick={() => setActiveTab('solve')}
          >Solve</div>
          <div
            className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >Settings</div>
          <div
            className={`nav-tab ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >Logs</div>
        </div>
      </header>

      {activeTab === 'solve' && (
        <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1' }}></div>
              <span className="section-label" style={{ margin: 0 }}>Quiz Assistant</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '12px' }}>
              Scans for questions and uses <strong>{model}</strong> to find and click the correct answer.
            </p>
            <button
              className="btn-primary"
              onClick={handleSolve}
              disabled={loading}
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
            >
              {loading ? <div className="spinner" /> : null}
              {loading ? 'Solving...' : 'Solve Quiz'}
            </button>
          </div>

          <div className="card" style={{ borderColor: 'rgba(16, 185, 129, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></div>
              <span className="section-label" style={{ margin: 0 }}>Course Automation</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '12px' }}>
              Automatically navigates through modules, clicks "Next", and marks content as complete.
            </p>
            <div style={{display: 'flex', gap: '8px'}}>
              <button 
                className="btn-primary" 
                onClick={() => handleAutomation('autoCourse')}
                disabled={loading}
                style={{flex: 2, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.2)'}}
              >
                {loading ? <div className="spinner" /> : null}
                {loading ? 'Automating...' : 'Start Auto-Course'}
              </button>
              <button 
                className="btn-primary" 
                onClick={() => handleAutomation('stop')}
                style={{flex: 1, background: 'rgba(244, 63, 94, 0.2)', color: '#f43f5e', boxShadow: 'none', border: '1px solid rgba(244, 63, 94, 0.3)'}}
              >
                Stop
              </button>
            </div>
          </div>

          <div className="status-tray">
            {logs.slice(0, 3).map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <div className="log-dot" />
                <span>{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card">
            <span className="section-label">Ollama Model</span>
            <div className="input-group">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {availableModels.length > 0 ? (
                  availableModels.map(m => <option key={m} value={m}>{m}</option>)
                ) : (
                  <option value={model}>{model} (Not found)</option>
                )}
              </select>
              {availableModels.length === 0 && (
                <div style={{ fontSize: '0.65rem', color: '#f43f5e', marginTop: '4px' }}>
                  Warning: No local models detected. Is Ollama running?
                </div>
              )}
            </div>
            <div className="toggle-switch">
              <span>Auto-advance pages</span>
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                style={{ width: 'auto' }}
              />
            </div>
          </div>

          <div className="card" style={{ padding: '12px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            Ensure Ollama is running at <code>http://localhost:11434</code> with CORS enabled.
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="tab-content">
          <div className="status-tray" style={{ height: '350px' }}>
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <div style={{ minWidth: '60px', color: 'var(--text-dim)', fontSize: '0.6rem' }}>{log.timestamp}</div>
                <span>{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="footer">
        Ollama Browser Automation Agent v1.0.0
      </footer>
    </div>
  )
}

export default App

