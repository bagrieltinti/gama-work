import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './components/LandingPage.tsx'

function Root() {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);
  return pathname === '/' || /^\/landing\/?$/.test(pathname) ? <LandingPage /> : <App />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
