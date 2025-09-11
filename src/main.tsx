/* src/main.tsx */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css';
import ErrorBoundary from './ErrorBoundary'

/*
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/intervals-icu-bulk-uploader-planned-workouts">
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
*/

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename="/intervals-icu-bulk-uploader-planned-workouts">
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)