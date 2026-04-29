import { useEffect, useCallback } from 'react';
import type { TriageState } from '../../shared/types';

export interface KeyboardNavOptions {
  /** Called when j/ArrowDown is pressed */
  onNext?: () => void;
  /** Called when k/ArrowUp is pressed */
  onPrev?: () => void;
  /** Called when 1-7 is pressed with the corresponding triage state */
  onTriage?: (state: TriageState) => void;
  /** Called when 'n' is pressed — focus notes */
  onNotes?: () => void;
  /** Called when 't' is pressed — focus tags */
  onTags?: () => void;
  /** Called when '/' is pressed — focus search */
  onSearch?: () => void;
  /** Called when '?' is pressed — toggle help */
  onHelp?: () => void;
  /** Called when Escape is pressed */
  onEscape?: () => void;
  /** When true, all handlers are disabled (e.g. while typing in an input) */
  disabled?: boolean;
}

const TRIAGE_KEYS: Record<string, TriageState> = {
  '1': 'new',
  '2': 'reviewing',
  '3': 'notable',
  '4': 'dismissed',
  '5': 'false_positive',
  '6': 'monitoring',
  '7': 'needs_followup',
};

/** Returns true if the event target is a text input — we skip hotkeys in that case. */
function isTextInput(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Global keyboard navigation hook.
 * Register once high in the tree (e.g. on a page component).
 * All handlers are no-ops when focus is in a text input.
 */
export function useKeyboardNav(options: KeyboardNavOptions) {
  const {
    onNext,
    onPrev,
    onTriage,
    onNotes,
    onTags,
    onSearch,
    onHelp,
    onEscape,
    disabled = false,
  } = options;

  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;
      if (isTextInput(e.target)) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          onNext?.();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          onPrev?.();
          break;
        case 'n':
          e.preventDefault();
          onNotes?.();
          break;
        case 't':
          e.preventDefault();
          onTags?.();
          break;
        case '/':
          e.preventDefault();
          onSearch?.();
          break;
        case '?':
          e.preventDefault();
          onHelp?.();
          break;
        case 'Escape':
          onEscape?.();
          break;
        default: {
          const triageState = TRIAGE_KEYS[e.key];
          if (triageState) {
            e.preventDefault();
            onTriage?.(triageState);
          }
        }
      }
    },
    [disabled, onNext, onPrev, onTriage, onNotes, onTags, onSearch, onHelp, onEscape],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}

export const KEYBOARD_SHORTCUTS = [
  { key: 'j / ↓', description: 'Next host' },
  { key: 'k / ↑', description: 'Previous host' },
  { key: '1', description: 'Triage: new' },
  { key: '2', description: 'Triage: reviewing' },
  { key: '3', description: 'Triage: notable' },
  { key: '4', description: 'Triage: dismissed' },
  { key: '5', description: 'Triage: false positive' },
  { key: '6', description: 'Triage: monitoring' },
  { key: '7', description: 'Triage: needs followup' },
  { key: 'n', description: 'Focus notes' },
  { key: 't', description: 'Focus tags' },
  { key: '/', description: 'Focus search' },
  { key: '?', description: 'Toggle this help' },
  { key: 'Esc', description: 'Close / deselect' },
] as const;
