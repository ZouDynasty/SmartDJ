import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/lato/400.css'
import '@fontsource/lato/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
