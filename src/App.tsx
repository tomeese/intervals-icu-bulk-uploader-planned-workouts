import React from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import DemoGuardrails from './pages/DemoGuardrails'
// If your existing root app is in another component, import it here:
// import ExistingApp from './ExistingApp'

function ExistingApp() {
  // temporary stub if you don’t have a component handy:
  return <div style={{padding:16}}>Existing app home. Go to <Link to="/demo">Demo</Link></div>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ExistingApp />} />
      <Route path="/demo" element={<DemoGuardrails />} />
      <Route path="*" element={<ExistingApp />} />
    </Routes>
  )
}