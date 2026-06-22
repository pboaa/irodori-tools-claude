import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base must match the GitHub Pages project path: /<repo>/
export default defineConfig({
  base: '/irodori-tools-claude/',
  plugins: [react()],
})
