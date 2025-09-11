/* src/App.tsx */
import { Routes, Route, Navigate } from 'react-router-dom';
import DemoGuardrails from './pages/DemoGuardrails';
import Nav from './components/Nav';

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to="/demo" replace />} />
        <Route path="/demo" element={<DemoGuardrails />} />
        <Route path="*" element={<Navigate to="/demo" replace />} />
      </Routes>
    </>
  );
}
