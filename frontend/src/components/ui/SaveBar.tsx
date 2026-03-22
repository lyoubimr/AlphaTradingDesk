import { Save, Loader2, Check, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/cn'

interface SaveBarProps {
  saving: boolean
  saved: boolean
  saveErr: string | null
  /** Disable the button when there are no changes to save */
  dirty?: boolean
  /** Extra validation guard (e.g. invalid form values) */
  disabled?: boolean
  onSave: () => void
}

/**
 * Shared save bar for settings pages.
 *
 * Layout: [error / "Unsaved changes" hint]  ............  [Save button]
 *
 * Button states:
 *   - idle:    blue  "Save changes"
 *   - saving:  spinner "Saving…"
 *   - saved:   green "Saved!" (3 s, then resets)
 *   - error:   blue (error shown on the left)
 *
 * Props:
 *   dirty    — when provided, button is disabled if false (no pending changes)
 *   disabled — extra guard for validation failures (weight sum, etc.)
 */
export function SaveBar({ saving, saved, saveErr, dirty, disabled, onSave }: SaveBarProps) {
  const isDisabled = saving || disabled === true || (dirty !== undefined && !dirty)

  return (
    <div className="flex items-center justify-between pt-5 border-t border-surface-700 mt-4">

      {/* Left: error / unsaved hint */}
      <div className="text-xs min-h-[1rem]">
        {saveErr ? (
          <span className="text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {saveErr}
          </span>
        ) : dirty === false || (dirty === undefined && !saved) ? null : dirty && !saving && !saved ? (
          <span className="text-amber-400/70">· Unsaved changes</span>
        ) : null}
      </div>

      {/* Right: button */}
      <button
        type="button"
        onClick={onSave}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40',
          saved && !saveErr
            ? 'bg-emerald-600 text-white'
            : 'bg-brand-600 hover:bg-brand-500 text-white',
        )}
      >
        {saving   ? <Loader2 size={12} className="animate-spin" />
         : saved  ? <Check   size={12} />
         :          <Save    size={12} />}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
      </button>

    </div>
  )
}
