import React from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import DemoGuardrails from './pages/DemoGuardrails'

// Stub for your existing app; replace with your real root component if you have one
function ExistingApp() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: 0 }}>Intervals Uploader</h1>
      <p>Home. Head over to the <Link to="/demo">Demo</Link>.</p>
    </div>
  )
}

function SiteNav() {
  const a = { padding: '8px 12px', borderRadius: 10, textDecoration: 'none', border: '1px solid #e2e8f0' }
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(6px)', background: 'rgba(255,255,255,.85)', borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, maxWidth: 960, margin: '0 auto' }}>
        <Link to="/" style={{ ...a }}>Home</Link>
        <Link to="/demo" style={{ ...a }}>Demo</Link>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <>
      <SiteNav />
      <Routes>
        <Route path="/" element={<Navigate to="/demo" replace />} />
        <Route path="/demo" element={<DemoGuardrails />} />
        <Route path="*" element={<Navigate to="/demo" replace />} />

      </Routes>
    </>
  )
}
