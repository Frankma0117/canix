import type { GarmentQuestionView, WardrobeTaxonomy } from '../../../types/index.ts';
import { Select } from '../../atoms/Input.tsx';

/** Every other allowed value of the question's field, for when none of the offered ones is right. */
export function OtherOption({ taxonomy, question, disabled, onPick }: { taxonomy: WardrobeTaxonomy | null; question: GarmentQuestionView; disabled: boolean; onPick: (value: string) => void }) {
  if (!taxonomy || question.field === 'is_garment') return null;
  const offered = new Set(question.options.map((o) => o.value));
  const select = '!w-auto !py-1.5 !text-xs';

  if (question.field === 'category') {
    return (
      <Select className={select} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="">Es otra prenda…</option>
        {taxonomy.types.map((t) => (
          <optgroup key={t.value} label={t.label}>
            {t.categories
              .filter((c) => !offered.has(c.value))
              .map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    );
  }
  const rest = (taxonomy.fields.find((f) => f.key === question.field)?.options ?? []).filter((o) => !offered.has(o.value));
  if (rest.length === 0) return null;
  return (
    <Select className={select} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">Otra opción…</option>
      {rest.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
