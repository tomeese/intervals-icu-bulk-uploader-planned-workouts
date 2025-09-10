import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/intervals-icu-bulk-uploader-planned-workouts">
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
