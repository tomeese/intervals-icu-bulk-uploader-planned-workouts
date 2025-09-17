import React from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";

import MainApp from "./pages/MainApp";
import DemoGuardrails from "./pages/DemoGuardrails";
import Planner from "./pages/Planner";
import PlanApp from "./pages/PlanApp";

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          "px-3 py-2 rounded-md text-sm font-medium",
          isActive
            ? "bg-slate-900 text-white"
            : "text-slate-700 hover:bg-slate-100",
        ].join(" ")
      }
    >
      {children}
    </NavLink>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <h1 className="text-lg font-semibold">Intervals Tools</h1>
          <nav className="flex gap-2">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/plan">Plan</NavItem>
            <NavItem to="/demo">Demo</NavItem>
            <NavItem to="/planner">Planner</NavItem>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Routes>
          <Route path="/" element={<MainApp />} />
          <Route path="/plan" element={<PlanApp />} />
          <Route path="/demo" element={<DemoGuardrails />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
