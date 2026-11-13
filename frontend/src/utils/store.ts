import type { Tone } from '../components/atoms/Badge.tsx';
import type { Order, OrderStatus } from '../types/store.ts';
import { formatDayLong, time12, todayISO } from './dates.ts';

/** "$25.000" - whole pesos with dot thousands. */
export function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString('es-CO').replace(/,/g, '.')}`;
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Por confirmar', tone: 'warning' },
  confirmed: { label: 'Confirmado', tone: 'info' },
  shipped: { label: 'Enviado', tone: 'violet' },
  delivered: { label: 'Entregado', tone: 'success' },
  rejected: { label: 'Rechazado', tone: 'error' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

export function paymentLabel(order: Pick<Order, 'payment_method' | 'payment_status'>): { label: string; tone: Tone } {
  if (order.payment_method === 'cash') return order.payment_status === 'verified' ? { label: 'Efectivo · pagado', tone: 'success' } : { label: 'Efectivo contra entrega', tone: 'neutral' };
  switch (order.payment_status) {
    case 'proof_received':
      return { label: 'Comprobante por revisar', tone: 'warning' };
    case 'verified':
      return { label: 'Pago verificado', tone: 'success' };
    case 'rejected':
      return { label: 'Comprobante rechazado', tone: 'error' };
    default:
      return { label: 'Falta el comprobante', tone: 'neutral' };
  }
}

/** '2026-11-13 10:42:00' -> '10:42 a. m.' today, 'jueves 12 de noviembre, 10:42 a. m.' otherwise. */
export function shortWhen(at: string | null): string {
  if (!at) return '';
  return at.slice(0, 10) === todayISO() ? time12(at) : `${formatDayLong(at.slice(0, 10))}, ${time12(at)}`;
}

export function itemsLine(order: Pick<Order, 'items'>): string {
  return order.items.map((i) => `${i.quantity} × ${i.name}`).join(' · ');
}
