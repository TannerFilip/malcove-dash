import type { TriageState } from '../../shared/types';

const STATE_STYLES: Record<TriageState, string> = {
  new:             'bg-sky-900/50 text-sky-300 ring-sky-700',
  reviewing:       'bg-yellow-900/50 text-yellow-300 ring-yellow-700',
  notable:         'bg-rose-900/50 text-rose-300 ring-rose-700',
  dismissed:       'bg-zinc-800 text-zinc-500 ring-zinc-700',
  false_positive:  'bg-zinc-800 text-zinc-500 ring-zinc-700',
  monitoring:      'bg-violet-900/50 text-violet-300 ring-violet-700',
  needs_followup:  'bg-orange-900/50 text-orange-300 ring-orange-700',
};

const STATE_LABELS: Record<TriageState, string> = {
  new:             'new',
  reviewing:       'reviewing',
  notable:         'notable',
  dismissed:       'dismissed',
  false_positive:  'false pos',
  monitoring:      'monitoring',
  needs_followup:  'followup',
};

export function TriageBadge({ state }: { state: TriageState }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_STYLES[state]}`}
    >
      {STATE_LABELS[state]}
    </span>
  );
}
