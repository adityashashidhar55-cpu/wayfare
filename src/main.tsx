import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ServerSetup from '@/components/ServerSetup'
import { isNativeApp, getServerUrl } from '@/lib/apiBase'

// Native (Capacitor) shell with no saved server yet → first-launch setup gate.
const nativeNeedsServer = isNativeApp() && !getServerUrl()

createRoot(document.getElementById('root')!).render(
  nativeNeedsServer ? <ServerSetup /> : <App />
)

// PWA service worker - production builds only, so dev HMR is never affected.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort */
    })
  })
}
