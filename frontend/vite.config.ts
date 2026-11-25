import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: [
      'sb-5iuy9p194vfp.vercel.run',
      'sb-6oj1vxiky7e9.vercel.run',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
})
