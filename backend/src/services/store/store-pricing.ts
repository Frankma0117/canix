import { storeCatalogModel } from '../../models/store.model.js';
import { parseWall, todayLocal } from '../../shared/utils/datetime.js';
import type { Store, StoreProduct, StorePromotion } from '../../entities/index.js';

/** "$25.000" - whole units with dot thousands, the way prices are written in Colombia. */
export function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString('es-CO').replace(/,/g, '.')}`;
}

export function promoWeekdays(promo: Pick<StorePromotion, 'weekdays'>): number[] | null {
  if (!promo.weekdays) return null;
  try {
    const parsed = JSON.parse(promo.weekdays) as unknown;
    const days = Array.isArray(parsed) ? parsed.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    return days.length ? days : null;
  } catch {
    return null;
  }
}

/** True when the promotion applies on `date` ('YYYY-MM-DD', default today in the bot's time zone). */
export function promoAppliesOn(promo: StorePromotion, date: string = todayLocal()): boolean {
  if (!promo.active) return false;
  if (promo.start_date && date < promo.start_date) return false;
  if (promo.end_date && date > promo.end_date) return false;
  const days = promoWeekdays(promo);
  return !days || days.includes(parseWall(`${date} 12:00:00`).getUTCDay());
}

export function promotionsToday(storeId: number): StorePromotion[] {
  return storeCatalogModel.promotions(storeId).filter((p) => promoAppliesOn(p));
}

export interface PricedProduct extends StoreProduct {
  /** What it costs today: the best active promotion price, or the list price. */
  current_price: number;
  promo_title: string | null;
}

/** The catalog with today's prices - the ONLY source of prices for the assistant and for orders. */
export function pricedProducts(storeId: number): PricedProduct[] {
  const promos = promotionsToday(storeId).filter((p) => p.product_id !== null && p.promo_price !== null);
  return storeCatalogModel.products(storeId).map((product) => {
    const best = promos.filter((p) => p.product_id === product.id && p.promo_price! < product.price).sort((a, b) => a.promo_price! - b.promo_price!)[0];
    return { ...product, current_price: best ? best.promo_price! : product.price, promo_title: best ? best.title : null };
  });
}

export function pricedProduct(storeId: number, productId: number): PricedProduct | undefined {
  return pricedProducts(storeId).find((p) => p.id === productId);
}

/** Delivery fee for a subtotal ("domicilio gratis desde..." included). */
export function deliveryFeeFor(store: Pick<Store, 'delivery_fee' | 'free_delivery_from'>, subtotal: number): number {
  if (store.free_delivery_from !== null && subtotal >= store.free_delivery_from) return 0;
  return store.delivery_fee;
}
