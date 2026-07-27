import type { ReactNode } from 'react'
import { CheckForUpdatesButton } from '@/components/CheckForUpdatesButton'
import { useAppStore } from '@/store/useAppStore'

function Toggle({
  label,
  description,
  enabled,
  onChange,
}: {
  label: string
  description: string
  enabled: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors ${
          enabled ? 'bg-sky-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            enabled ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </button>
      <span className="text-xs leading-tight text-zinc-400">
        <span className="font-medium text-zinc-200">{label}</span>
        <br />
        {description}
      </span>
    </label>
  )
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export default function Settings() {
  const {
    autoOpenBuild,
    setAutoOpenBuild,
    showServerStatus,
    setShowServerStatus,
    overlayEnabled,
    setOverlayEnabled,
    overlayShowBuild,
    setOverlayShowBuild,
    overlayShowEnemies,
    setOverlayShowEnemies,
    overlayShowAugmentBadges,
    setOverlayShowAugmentBadges,
  } = useAppStore()

  return (
    <div className="max-w-xl space-y-6">
      <SettingsSection title="General">
        <Toggle
          label="Auto-open build"
          description="Jump to the build page when champ select starts."
          enabled={autoOpenBuild}
          onChange={setAutoOpenBuild}
        />
      </SettingsSection>

      <SettingsSection title="Server">
        <Toggle
          label="Show server status"
          description="Display the League server-status pill in the nav bar."
          enabled={showServerStatus}
          onChange={setShowServerStatus}
        />
      </SettingsSection>

      <SettingsSection title="Overlay">
        <Toggle
          label="Enable overlay"
          description="Master switch for the in-game overlay. Same as the Ctrl+Shift+L hotkey."
          enabled={overlayEnabled}
          onChange={setOverlayEnabled}
        />
        <Toggle
          label="Build panel"
          description="Build Next + Build Path card, top-right by default."
          enabled={overlayShowBuild}
          onChange={setOverlayShowBuild}
        />
        <Toggle
          label="Enemy panel"
          description="Enemy comp/items card, top-left by default — drag either panel independently."
          enabled={overlayShowEnemies}
          onChange={setOverlayShowEnemies}
        />
        <Toggle
          label="Augment pick badges"
          description="ARAM Mayhem: win-rate/tier badges over the augment pick screen."
          enabled={overlayShowAugmentBadges}
          onChange={setOverlayShowAugmentBadges}
        />
      </SettingsSection>

      <SettingsSection title="Updates">
        <CheckForUpdatesButton />
      </SettingsSection>
    </div>
  )
}
