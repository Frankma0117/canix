import { useState, type ReactNode } from 'react';
import { Modal } from '../Modal.tsx';
import { Button } from '../../atoms/Button.tsx';

/** Asks before something that can't be undone. `onConfirm` may be async; the button shows it working. */
export function ConfirmDialog({ title, children, cta, onConfirm, onCancel }: { title: string; children: ReactNode; cta: string; onConfirm: () => void | Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm leading-relaxed text-gray-dark">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await Promise.resolve(onConfirm()).finally(() => setBusy(false));
          }}
        >
          {cta}
        </Button>
      </div>
    </Modal>
  );
}
