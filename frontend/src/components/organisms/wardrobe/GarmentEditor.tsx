import { useEffect, useMemo, useState } from 'react';
import { errMsg, type Api } from '../../../services/api.ts';
import type { GarmentDetail, GarmentFieldValue, WardrobeTaxonomy } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Modal } from '../Modal.tsx';
import { Input, Label, Select, Textarea, Hint } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { ByUserNote } from '../../molecules/wardrobe/ByUserNote.tsx';
import { FilterChip } from '../../molecules/wardrobe/FilterChip.tsx';

export function GarmentEditor({ api, taxonomy, garmentId, onClose, onSaved }: { api: Api; taxonomy: WardrobeTaxonomy; garmentId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [garment, setGarment] = useState<GarmentDetail | null>(null);
  const [fields, setFields] = useState<Record<string, GarmentFieldValue>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<GarmentDetail>(`/api/garments/${garmentId}`)
      .then((g) => {
        setGarment(g);
        setFields(g.fields);
      })
      .catch((e) => setError(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garmentId]);

  const type = useMemo(() => taxonomy.types.find((t) => t.categories.some((c) => c.value === fields.category))?.value, [taxonomy, fields.category]);

  function change(key: string, value: GarmentFieldValue) {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty((d) => new Set(d).add(key));
  }

  async function save() {
    if (dirty.size === 0) return onClose();
    setSaving(true);
    setError(null);
    try {
      // Only what was touched is sent: each of those becomes "dicho por ti" and is never re-guessed.
      await api.put(`/api/garments/${garmentId}`, { fields: Object.fromEntries([...dirty].map((k) => [k, fields[k]])) });
      toast.success('Prenda actualizada');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Prenda" description={garment?.long_description ?? undefined} onClose={onClose} size="lg">
      {error && <Notice tone="error">{error}</Notice>}
      {garment && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,240px)_1fr]">
          <div>
            <a href={garment.full_image_url} target="_blank" rel="noreferrer">
              <img src={garment.full_image_url} alt={garment.category_label} className="w-full rounded-2xl object-cover" />
            </a>
            {garment.seen && (
              <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-gray-dark dark:bg-white/5">
                <span className="font-semibold text-ink dark:text-white">Lo que vi en la foto: </span>
                {garment.seen}
              </p>
            )}
            <p className="mt-2 text-xs text-gray-dark">
              {garment.classified_by === 'vision' ? 'Clasificada mirando la foto.' : garment.classified_by === 'local' ? 'Clasificada con el método anterior; está en cola para revisarse.' : 'Clasificada a mano.'}
            </p>
          </div>

          <div className="grid content-start gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Prenda {garment.by_user.includes('category') && <ByUserNote />}</Label>
              <Select value={(fields.category as string) ?? ''} onChange={(e) => change('category', e.target.value)}>
                {taxonomy.types.map((t) => (
                  <optgroup key={t.value} label={t.label}>
                    {t.categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            {taxonomy.fields
              .filter((f) => !f.only_types || !type || f.only_types.includes(type))
              .map((f) => (
                <div key={f.key} className={f.kind === 'many' || f.key === 'notes' ? 'sm:col-span-2' : ''}>
                  <Label>
                    {f.label} {garment.by_user.includes(f.key) && <ByUserNote />}
                  </Label>
                  {f.kind === 'one' && (
                    <Select value={(fields[f.key] as string) ?? ''} onChange={(e) => change(f.key, e.target.value || null)}>
                      <option value="">Sin definir</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  {f.kind === 'many' && (
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map((o) => {
                        const current = (fields[f.key] as string[] | null) ?? [];
                        const on = current.includes(o.value);
                        return (
                          <FilterChip key={o.value} active={on} onClick={() => change(f.key, on ? current.filter((v) => v !== o.value) : [...current, o.value])}>
                            {o.label}
                          </FilterChip>
                        );
                      })}
                    </div>
                  )}
                  {f.kind === 'text' &&
                    (f.key === 'notes' ? (
                      <Textarea rows={2} value={(fields[f.key] as string) ?? ''} onChange={(e) => change(f.key, e.target.value)} />
                    ) : (
                      <Input value={(fields[f.key] as string) ?? ''} onChange={(e) => change(f.key, e.target.value)} />
                    ))}
                </div>
              ))}
            <div className="sm:col-span-2">
              <Hint>Lo que cambies aquí queda como dicho por ti: ninguna revisión automática lo vuelve a tocar.</Hint>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button onClick={save} loading={saving}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
