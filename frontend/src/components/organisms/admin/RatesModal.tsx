import { useState } from 'react';
import { DEFAULT_RATES, type Rates } from '../../../services/usage.ts';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';

export function RatesModal({ rates, onSave, onClose }: { rates: Rates; onSave: (r: Rates) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(rates);
  const field = (key: keyof Rates, label: string, hint: string) => (
    <div>
      <Label>{label}</Label>
      <Input type="number" step="0.01" min="0" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} />
      <p className="mt-1 text-xs text-gray-dark">{hint}</p>
    </div>
  );
  return (
    <Modal title="Tarifas de estimación (USD)" description="Solo afectan los cálculos de esta pantalla en este navegador. Revisa los precios reales en cada proveedor." onClose={onClose} size="md">
      <div className="grid gap-4 sm:grid-cols-2">
        {field('tokenInPerM', 'IA: entrada por millón de tokens', 'DeepSeek / proveedor configurado')}
        {field('tokenOutPerM', 'IA: salida por millón de tokens', 'DeepSeek / proveedor configurado')}
        {field('fishPerMChars', 'Voz natural por millón de caracteres', 'Fish Audio')}
        {field('callEach', 'Costo promedio por llamada', 'Twilio (llamada corta)')}
      </div>
      <div className="mt-6 flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_RATES)}>
          Restaurar valores
        </Button>
        <Button onClick={() => onSave(draft)}>Guardar tarifas</Button>
      </div>
    </Modal>
  );
}
