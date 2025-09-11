/* src/App.tsx */

import { Routes, Route, NavLink } from 'react-router-dom'
import Planner from './pages/Planner'
import DemoGuardrails from './pages/DemoGuardrails'

export default function App() {
  return (
    <>
      <nav className="p-3 border-b flex gap-4">
        <NavLink to="/" end>Planner</NavLink>
        <NavLink to="/demo">Demo</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Planner/>} />
        <Route path="/demo" element={<DemoGuardrails/>} />
      </Routes>
    </>
  )
}
