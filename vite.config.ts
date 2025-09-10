import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


// IMPORTANT: set base to your repo name when hosting on GitHub Pages
// If your repo is "intervals-icu-bulk-uploader-planned-workouts", the base should be:
// '/intervals-icu-bulk-uploader-planned-workouts/'
export default defineConfig({
plugins: [react()],
base: '/intervals-icu-bulk-uploader-planned-workouts/',
})