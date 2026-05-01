import { useState } from 'react';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'number' | 'flag';

interface ShodanField {
  field: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  hint?: string;
}

const SHODAN_FIELDS: ShodanField[] = [
  // Service
  { field: 'port',                   label: 'Port',              type: 'number', placeholder: '443' },
  { field: 'product',                label: 'Product',           type: 'text',   placeholder: 'Cobalt Strike', hint: 'Quoted automatically if it contains spaces' },
  { field: 'http.title',             label: 'HTTP Title',        type: 'text',   placeholder: 'Admin Panel' },
  { field: 'http.status',            label: 'HTTP Status',       type: 'number', placeholder: '200' },
  { field: 'http.favicon.hash',      label: 'Favicon Hash',      type: 'number', placeholder: '-2082006835' },
  { field: 'http.html',              label: 'HTML Content',      type: 'text',   placeholder: 'login' },
  // TLS / Certs
  { field: 'ssl.jarm',               label: 'JARM',              type: 'text',   placeholder: '2ad...' },
  { field: 'ssl.cert.serial',        label: 'Cert Serial',       type: 'text',   placeholder: '123456789' },
  { field: 'ssl.cert.subject.cn',    label: 'Cert Subject CN',   type: 'text',   placeholder: '*.evil.cc' },
  { field: 'ssl.cert.issuer.cn',     label: 'Cert Issuer CN',    type: 'text',   placeholder: "Let's Encrypt" },
  // Network / Org
  { field: 'org',                    label: 'Organization',      type: 'text',   placeholder: 'DigitalOcean' },
  { field: 'asn',                    label: 'ASN',               type: 'text',   placeholder: 'AS14061' },
  { field: 'country',                label: 'Country',           type: 'text',   placeholder: 'RU' },
  { field: 'hostname',               label: 'Hostname',          type: 'text',   placeholder: '*.dyn.co' },
  { field: 'net',                    label: 'Network / IP',      type: 'text',   placeholder: '192.168.0.0/24' },
  { field: 'os',                     label: 'OS',                type: 'text',   placeholder: 'Windows' },
  // Flags
  { field: 'has_ssl',                label: 'Has SSL',           type: 'flag' },
  { field: 'has_screenshot',         label: 'Has Screenshot',    type: 'flag' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Term {
  id: string;
  field: string;
  value: string;
  negated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function needsQuotes(value: string): boolean {
  return /\s/.test(value) && !value.startsWith('"');
}

function termToString(term: Term, fieldDef: ShodanField | undefined): string {
  const neg = term.negated ? '-' : '';
  if (fieldDef?.type === 'flag') {
    return `${neg}${term.field}:true`;
  }
  const val = needsQuotes(term.value) ? `"${term.value}"` : term.value;
  return `${neg}${term.field}:${val}`;
}

function assembleQuery(terms: Term[]): string {
  return terms
    .filter((t) => t.value.trim() !== '' || SHODAN_FIELDS.find((f) => f.field === t.field)?.type === 'flag')
    .map((t) => termToString(t, SHODAN_FIELDS.find((f) => f.field === t.field)))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface QueryBuilderProps {
  /** Called when user wants to use the assembled query */
  onInsert: (query: string) => void;
}

export function QueryBuilder({ onInsert }: QueryBuilderProps) {
  const [terms, setTerms] = useState<Term[]>([
    { id: nanoid(), field: 'port', value: '', negated: false },
  ]);

  function addTerm() {
    setTerms((prev) => [...prev, { id: nanoid(), field: 'port', value: '', negated: false }]);
  }

  function removeTerm(id: string) {
    setTerms((prev) => prev.filter((t) => t.id !== id));
  }

  function updateTerm(id: string, patch: Partial<Omit<Term, 'id'>>) {
    setTerms((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  const assembled = assembleQuery(terms);

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900/60 p-3">
      <p className="text-xs font-medium text-zinc-400">Query builder</p>

      {/* Term rows */}
      <div className="space-y-1.5">
        {terms.map((term) => {
          const fieldDef = SHODAN_FIELDS.find((f) => f.field === term.field);
          return (
            <div key={term.id} className="flex items-center gap-1.5">
              {/* Negate toggle */}
              <button
                type="button"
                onClick={() => updateTerm(term.id, { negated: !term.negated })}
                title="Negate this term"
                className={`w-5 shrink-0 text-center text-xs font-mono ${
                  term.negated ? 'text-rose-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                −
              </button>

              {/* Field selector */}
              <select
                value={term.field}
                onChange={(e) => updateTerm(term.id, { field: e.target.value, value: '' })}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-300 focus:border-sky-600 focus:outline-none"
              >
                {SHODAN_FIELDS.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>

              {/* Value input — hidden for flags */}
              {fieldDef?.type !== 'flag' && (
                <input
                  type={fieldDef?.type === 'number' ? 'text' : 'text'}
                  inputMode={fieldDef?.type === 'number' ? 'numeric' : 'text'}
                  value={term.value}
                  onChange={(e) => updateTerm(term.id, { value: e.target.value })}
                  placeholder={fieldDef?.placeholder ?? ''}
                  className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-sky-600 focus:outline-none"
                />
              )}
              {fieldDef?.type === 'flag' && (
                <span className="flex-1 text-xs text-zinc-600 italic">
                  boolean flag — always true
                </span>
              )}

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeTerm(term.id)}
                disabled={terms.length === 1}
                className="text-zinc-700 hover:text-rose-400 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Add term */}
      <button
        type="button"
        onClick={addTerm}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        + add term
      </button>

      {/* Preview + insert */}
      {assembled && (
        <div className="space-y-1.5 border-t border-zinc-800 pt-2">
          <p className="break-all font-mono text-xs text-zinc-400">{assembled}</p>
          <button
            type="button"
            onClick={() => onInsert(assembled)}
            className="rounded border border-sky-700 px-3 py-0.5 text-xs text-sky-400 hover:bg-sky-900/30"
          >
            ↑ use this query
          </button>
        </div>
      )}
    </div>
  );
}
