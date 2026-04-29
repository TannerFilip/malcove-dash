import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardNav';

export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-100">Keyboard shortcuts</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">
            esc
          </button>
        </div>
        <table className="w-full text-xs">
          <tbody>
            {KEYBOARD_SHORTCUTS.map((s) => (
              <tr key={s.key} className="border-t border-zinc-800 first:border-0">
                <td className="py-1 pr-4 font-mono text-zinc-300">{s.key}</td>
                <td className="py-1 text-zinc-500">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
