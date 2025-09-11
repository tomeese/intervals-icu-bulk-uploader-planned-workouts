/* vite.config.ts */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Use pretty URLs on Pages; plain '/' in dev
  base: command === 'build' ? '/intervals-icu-bulk-uploader-planned-workouts/' : '/',
}))
