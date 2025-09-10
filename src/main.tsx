// TEMP: boot probe
console.log("BOOT: main.tsx running");
document.getElementById('root')!.textContent = "Loading…";

import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/intervals-icu-bulk-uploader-planned-workouts">
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
