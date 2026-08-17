import { useState } from 'react'
import { CompassMark } from '@/components/Logo'
import { setServerUrl } from '@/lib/apiBase'

/**
 * First-launch gate for the native (Capacitor) shell: the bundled app is served
 * from the WebView's local origin, so it cannot reach the deployment until the
 * user tells it which server to talk to. Saved once, then the app reloads.
 */
export default function ServerSetup() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const save = () => {
    let url = value.trim()
    if (!url) {
      setError('Enter your server address to continue.')
      return
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    try {
      new URL(url)
    } catch {
      setError('That does not look like a valid address (e.g. https://wayfare.example.com).')
      return
    }
    setServerUrl(url)
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-ink">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-md">
        <div className="mb-6 flex items-center gap-2">
          <CompassMark className="h-8 w-8 text-brand" />
          <span className="font-serif text-[24px] font-semibold leading-none tracking-[-0.02em]">
            Wayfare
          </span>
        </div>
        <h1 className="type-h3 mb-2">Connect to your server</h1>
        <p className="type-body mb-6 text-ink-2">
          Enter the address of your Wayfare deployment (shown on its Get the app
          page). You only have to do this once.
        </p>
        <label htmlFor="server-url" className="type-caption mb-2 block text-ink-3">
          SERVER ADDRESS
        </label>
        <input
          id="server-url"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://wayfare.example.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className="mb-2 w-full rounded-md border border-border-strong bg-bg px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
        />
        {error && <p className="type-small mb-2 text-danger">{error}</p>}
        <button
          type="button"
          onClick={save}
          className="mt-3 w-full rounded-md bg-brand px-4 py-3 text-[15px] font-semibold text-brand-ink transition-colors duration-fast hover:bg-brand-strong"
        >
          Save and continue
        </button>
      </div>
    </div>
  )
}
