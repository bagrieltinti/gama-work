import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './components/LandingPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/^\/landing\/?$/.test(window.location.pathname) ? <LandingPage /> : <App />}
  </StrictMode>,
)
