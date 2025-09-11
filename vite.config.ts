/* vite.config.ts */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/intervals-icu-bulk-uploader-planned-workouts/' : '/',
  preview: {
    open: '/intervals-icu-bulk-uploader-planned-workouts/#/demo',
    port: 4173,
    strictPort: true,
  },
}))
