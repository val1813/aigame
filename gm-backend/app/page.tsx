'use client'
import { useState, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:9000'

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('gm_token') || '' : ''
}

export default function GMHome() {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [worlds, setWorlds] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    const t = getToken()
    if (t) { setToken(t); setLoggedIn(true); loadWorlds(t) }
  }, [])

  async function login() {
    const r = await fetch(`${API}/gm/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await r.json()
    if (data.ok) {
      const t = data.data.gm_token
      localStorage.setItem('gm_token', t)
      setToken(t); setLoggedIn(true); loadWorlds(t)
    } else {
      setError('Login failed')
    }
  }

  async function loadWorlds(t: string) {
    const r = await fetch(`${API}/gm/worlds`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    const data = await r.json()
    if (data.ok) setWorlds(data.data)
  }

  async function createWorld() {
    const name = prompt('World name?')
    if (!name) return
    const r = await fetch(`${API}/gm/worlds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        difficulty: 'B',
        description: '新关卡',
        baseline_time_ms: 480000,
        baseline_tokens: 4000,
        time_limit_ms: 1800000,
      }),
    })
    const data = await r.json()
    if (data.ok) loadWorlds(token)
  }

  async function publishWorld(id: string) {
    await fetch(`${API}/gm/worlds/${id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    loadWorlds(token)
  }

  if (!loggedIn) {
    return (
      <div style={styles.center}>
        <h2 style={{ color: '#1a7a44' }}>AgentWorld GM</h2>
        <input style={styles.input} placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input style={styles.input} placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button style={styles.btn} onClick={login}>Login</button>
        {error && <p style={{ color: '#cc3333' }}>{error}</p>}
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <h2 style={{ color: '#1a7a44' }}>AgentWorld GM Console</h2>
      <button style={styles.btn} onClick={createWorld}>+ New World</button>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>ID</th><th>Name</th><th>Difficulty</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {worlds.map((w: any) => (
            <tr key={w.id}>
              <td style={styles.td}>{w.id}</td>
              <td style={styles.td}>{w.name}</td>
              <td style={styles.td}>{w.difficulty}</td>
              <td style={styles.td}>{w.status}</td>
              <td style={styles.td}>
                {w.status === 'draft' && (
                  <button style={styles.btnSm} onClick={() => publishWorld(w.id)}>Publish</button>
                )}
                <a style={styles.link} href={`/gm/worlds/${w.id}`}>Edit</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 },
  page: { padding: 32 },
  input: { background: '#ffffff', border: '1px solid #ccd4dc', color: '#1a2a3a', padding: '8px 12px', borderRadius: 4, width: 280 },
  btn: { background: '#e6f7ee', border: '1px solid #22aa66', color: '#1a7a44', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' },
  btnSm: { background: '#e0eeff', border: '1px solid #4488cc', color: '#2266aa', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', marginRight: 8 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 24 },
  td: { padding: '8px 12px', borderBottom: '1px solid #dde3ea' },
  link: { color: '#2266cc', textDecoration: 'none' },
}
