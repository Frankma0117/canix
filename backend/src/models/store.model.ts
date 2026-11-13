import { db } from '../database/connection.js';
import { nowLocal } from '../shared/utils/datetime.js';
import type {
  ConversationMode,
  OrderStatus,
  Store,
  StoreCategory,
  StoreCustomer,
  StoreMessage,
  StoreMessageRole,
  StoreOrder,
  StoreOrderEvent,
  StoreOrderItem,
  StoreProduct,
  StorePromotion,
  User,
} from '../entities/index.js';

/**
 * Data access for the order-taking assistant. Every query is scoped by `store_id` - the route and
 * the service decide WHICH store the caller may touch (see services/store/store-access.ts).
 */

/** Builds "col = ?, col2 = ?" for the fields present in `patch` (only our own column names). */
function setClause<T extends object>(patch: T, allowed: readonly (keyof T & string)[]): { sql: string; values: unknown[] } {
  const keys = allowed.filter((k) => patch[k] !== undefined);
  return { sql: keys.map((k) => `${k} = ?`).join(', '), values: keys.map((k) => patch[k]) };
}

const STORE_FIELDS = [
  'name',
  'business_type',
  'description',
  'instructions',
  'assistant_name',
  'welcome_message',
  'hours_text',
  'address',
  'payment_info',
  'accepts_transfer',
  'accepts_cash',
  'allows_pickup',
  'delivery_fee',
  'free_delivery_from',
  'min_order',
  'delivery_zones',
  'bot_enabled',
  'active',
] as const;
export type StorePatch = Partial<Pick<Store, (typeof STORE_FIELDS)[number]>>;

export const storesModel = {
  list(): Store[] {
    return db.prepare('SELECT * FROM stores ORDER BY id').all() as Store[];
  },

  listForUser(userId: number): Store[] {
    return db
      .prepare('SELECT s.* FROM stores s JOIN store_members m ON m.store_id = s.id WHERE m.user_id = ? ORDER BY s.id')
      .all(userId) as Store[];
  },

  get(id: number): Store | undefined {
    return db.prepare('SELECT * FROM stores WHERE id = ?').get(id) as Store | undefined;
  },

  getDemo(): Store | undefined {
    return db.prepare('SELECT * FROM stores WHERE is_demo = 1 ORDER BY id LIMIT 1').get() as Store | undefined;
  },

  create(fields: StorePatch & { name: string; is_demo?: number }): Store {
    const now = nowLocal();
    const id = Number(
      db.prepare('INSERT INTO stores (name, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?)').run(fields.name, fields.is_demo ?? 0, now, now).lastInsertRowid,
    );
    this.update(id, fields);
    return this.get(id)!;
  },

  update(id: number, patch: StorePatch): void {
    const { sql, values } = setClause(patch, STORE_FIELDS);
    if (!sql) return;
    db.prepare(`UPDATE stores SET ${sql}, updated_at = ? WHERE id = ?`).run(...values, nowLocal(), id);
  },

  remove(id: number): void {
    db.prepare('DELETE FROM stores WHERE id = ?').run(id);
  },

  /** Hands out the next consecutive order number of this store. */
  takeOrderNumber(id: number): number {
    return db.transaction(() => {
      const row = db.prepare('SELECT next_order_number AS n FROM stores WHERE id = ?').get(id) as { n: number };
      db.prepare('UPDATE stores SET next_order_number = ? WHERE id = ?').run(row.n + 1, id);
      return row.n;
    })();
  },

  // ---- members ----
  members(storeId: number): (Pick<User, 'id' | 'name' | 'jid' | 'role'> & { notify: number; has_password: number })[] {
    return db
      .prepare(
        `SELECT u.id, u.name, u.jid, u.role, m.notify, (u.password_hash IS NOT NULL) AS has_password
         FROM store_members m JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.created_at`,
      )
      .all(storeId) as (Pick<User, 'id' | 'name' | 'jid' | 'role'> & { notify: number; has_password: number })[];
  },

  isMember(storeId: number, userId: number): boolean {
    return !!db.prepare('SELECT 1 FROM store_members WHERE store_id = ? AND user_id = ?').get(storeId, userId);
  },

  addMember(storeId: number, userId: number): void {
    db.prepare('INSERT INTO store_members (store_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(storeId, userId, nowLocal());
  },

  setMemberNotify(storeId: number, userId: number, notify: boolean): void {
    db.prepare('UPDATE store_members SET notify = ? WHERE store_id = ? AND user_id = ?').run(notify ? 1 : 0, storeId, userId);
  },

  removeMember(storeId: number, userId: number): void {
    db.prepare('DELETE FROM store_members WHERE store_id = ? AND user_id = ?').run(storeId, userId);
  },

  /** How many stores this person still manages (to know when `store.manage` can be taken back). */
  membershipCount(userId: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM store_members WHERE user_id = ?').get(userId) as { n: number }).n;
  },
};

const PRODUCT_FIELDS = ['category_id', 'name', 'description', 'details', 'price', 'image', 'available', 'featured', 'position'] as const;
export type ProductPatch = Partial<Pick<StoreProduct, (typeof PRODUCT_FIELDS)[number]>>;

const PROMO_FIELDS = ['title', 'description', 'product_id', 'promo_price', 'weekdays', 'start_date', 'end_date', 'image', 'active'] as const;
export type PromotionPatch = Partial<Pick<StorePromotion, (typeof PROMO_FIELDS)[number]>>;

export const storeCatalogModel = {
  categories(storeId: number): StoreCategory[] {
    return db.prepare('SELECT * FROM store_categories WHERE store_id = ? ORDER BY position, id').all(storeId) as StoreCategory[];
  },

  category(storeId: number, id: number): StoreCategory | undefined {
    return db.prepare('SELECT * FROM store_categories WHERE store_id = ? AND id = ?').get(storeId, id) as StoreCategory | undefined;
  },

  createCategory(storeId: number, name: string): number {
    const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM store_categories WHERE store_id = ?').get(storeId) as { p: number }).p;
    return Number(db.prepare('INSERT INTO store_categories (store_id, name, position) VALUES (?, ?, ?)').run(storeId, name, pos).lastInsertRowid);
  },

  updateCategory(storeId: number, id: number, patch: { name?: string; position?: number }): void {
    const { sql, values } = setClause(patch, ['name', 'position']);
    if (sql) db.prepare(`UPDATE store_categories SET ${sql} WHERE store_id = ? AND id = ?`).run(...values, storeId, id);
  },

  removeCategory(storeId: number, id: number): void {
    db.prepare('DELETE FROM store_categories WHERE store_id = ? AND id = ?').run(storeId, id);
  },

  products(storeId: number): StoreProduct[] {
    return db
      .prepare(
        `SELECT p.* FROM store_products p LEFT JOIN store_categories c ON c.id = p.category_id
         WHERE p.store_id = ? ORDER BY COALESCE(c.position, 9999), p.position, p.id`,
      )
      .all(storeId) as StoreProduct[];
  },

  product(storeId: number, id: number): StoreProduct | undefined {
    return db.prepare('SELECT * FROM store_products WHERE store_id = ? AND id = ?').get(storeId, id) as StoreProduct | undefined;
  },

  createProduct(storeId: number, fields: ProductPatch & { name: string; price: number }): number {
    const now = nowLocal();
    const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM store_products WHERE store_id = ?').get(storeId) as { p: number }).p;
    const id = Number(
      db
        .prepare('INSERT INTO store_products (store_id, name, price, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(storeId, fields.name, fields.price, pos, now, now).lastInsertRowid,
    );
    this.updateProduct(storeId, id, fields);
    return id;
  },

  updateProduct(storeId: number, id: number, patch: ProductPatch): void {
    const { sql, values } = setClause(patch, PRODUCT_FIELDS);
    if (!sql) return;
    db.prepare(`UPDATE store_products SET ${sql}, updated_at = ? WHERE store_id = ? AND id = ?`).run(...values, nowLocal(), storeId, id);
  },

  removeProduct(storeId: number, id: number): void {
    db.prepare('DELETE FROM store_products WHERE store_id = ? AND id = ?').run(storeId, id);
  },

  promotions(storeId: number): StorePromotion[] {
    return db.prepare('SELECT * FROM store_promotions WHERE store_id = ? ORDER BY active DESC, id DESC').all(storeId) as StorePromotion[];
  },

  promotion(storeId: number, id: number): StorePromotion | undefined {
    return db.prepare('SELECT * FROM store_promotions WHERE store_id = ? AND id = ?').get(storeId, id) as StorePromotion | undefined;
  },

  createPromotion(storeId: number, fields: PromotionPatch & { title: string }): number {
    const id = Number(db.prepare('INSERT INTO store_promotions (store_id, title, created_at) VALUES (?, ?, ?)').run(storeId, fields.title, nowLocal()).lastInsertRowid);
    this.updatePromotion(storeId, id, fields);
    return id;
  },

  updatePromotion(storeId: number, id: number, patch: PromotionPatch): void {
    const { sql, values } = setClause(patch, PROMO_FIELDS);
    if (sql) db.prepare(`UPDATE store_promotions SET ${sql} WHERE store_id = ? AND id = ?`).run(...values, storeId, id);
  },

  removePromotion(storeId: number, id: number): void {
    db.prepare('DELETE FROM store_promotions WHERE store_id = ? AND id = ?').run(storeId, id);
  },
};

export interface ConversationRow extends StoreCustomer {
  open_orders: number;
}

export const storeCustomersModel = {
  get(storeId: number, id: number): StoreCustomer | undefined {
    return db.prepare('SELECT * FROM store_customers WHERE store_id = ? AND id = ?').get(storeId, id) as StoreCustomer | undefined;
  },

  byJid(storeId: number, jid: string): StoreCustomer | undefined {
    return db.prepare('SELECT * FROM store_customers WHERE store_id = ? AND jid = ?').get(storeId, jid) as StoreCustomer | undefined;
  },

  /** The customer of this chat, created on their first message. */
  upsert(storeId: number, fields: { jid: string; phone?: string | null; name?: string | null; isSimulator?: boolean }): StoreCustomer {
    db.prepare(
      `INSERT INTO store_customers (store_id, jid, phone, name, is_simulator, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(store_id, jid) DO UPDATE SET
         phone = COALESCE(store_customers.phone, excluded.phone),
         name = COALESCE(store_customers.name, excluded.name)`,
    ).run(storeId, fields.jid, fields.phone ?? null, fields.name ?? null, fields.isSimulator ? 1 : 0, nowLocal());
    return this.byJid(storeId, fields.jid)!;
  },

  update(id: number, patch: Partial<Pick<StoreCustomer, 'name' | 'phone' | 'address' | 'address_reference'>>): void {
    const { sql, values } = setClause(patch, ['name', 'phone', 'address', 'address_reference']);
    if (sql) db.prepare(`UPDATE store_customers SET ${sql} WHERE id = ?`).run(...values, id);
  },

  setMode(id: number, mode: ConversationMode, reason: string | null = null): void {
    db.prepare('UPDATE store_customers SET mode = ?, handoff_reason = ?, handoff_at = ? WHERE id = ?').run(mode, mode === 'human' ? reason : null, mode === 'human' ? nowLocal() : null, id);
  },

  markRead(id: number): void {
    db.prepare('UPDATE store_customers SET unread = 0 WHERE id = ?').run(id);
  },

  conversations(storeId: number): ConversationRow[] {
    return db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM store_orders o WHERE o.customer_id = c.id AND o.status IN ('pending', 'confirmed', 'shipped')) AS open_orders
         FROM store_customers c WHERE c.store_id = ? AND c.last_message_at IS NOT NULL
         ORDER BY (c.mode = 'human') DESC, c.last_message_at DESC LIMIT 200`,
      )
      .all(storeId) as ConversationRow[];
  },

  remove(id: number): void {
    db.prepare('DELETE FROM store_customers WHERE id = ?').run(id);
  },
};

export const storeMessagesModel = {
  add(customer: Pick<StoreCustomer, 'id' | 'store_id'>, fields: { role: StoreMessageRole; body: string; kind?: 'text' | 'image'; media?: string | null; internal?: boolean }): StoreMessage {
    const now = nowLocal();
    const id = Number(
      db
        .prepare('INSERT INTO store_messages (store_id, customer_id, role, kind, body, media, internal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(customer.store_id, customer.id, fields.role, fields.kind ?? 'text', fields.body, fields.media ?? null, fields.internal ? 1 : 0, now).lastInsertRowid,
    );
    const preview = (fields.kind === 'image' ? `📷 ${fields.body}` : fields.body).replace(/\s+/g, ' ').trim().slice(0, 90);
    db.prepare(
      `UPDATE store_customers SET last_message_at = ?, last_message_preview = ?, unread = unread + ? WHERE id = ?`,
    ).run(now, preview, fields.role === 'customer' ? 1 : 0, customer.id);
    return db.prepare('SELECT * FROM store_messages WHERE id = ?').get(id) as StoreMessage;
  },

  list(customerId: number, afterId = 0, limit = 300): StoreMessage[] {
    const rows = db.prepare('SELECT * FROM store_messages WHERE customer_id = ? AND id > ? ORDER BY id DESC LIMIT ?').all(customerId, afterId, limit) as StoreMessage[];
    return rows.reverse();
  },

  /** The last turns of the chat as the model should see them (internal notes included, as context). */
  recent(customerId: number, limit: number): StoreMessage[] {
    const rows = db.prepare('SELECT * FROM store_messages WHERE customer_id = ? ORDER BY id DESC LIMIT ?').all(customerId, limit) as StoreMessage[];
    return rows.reverse();
  },

  byMedia(storeId: number, media: string): StoreMessage | undefined {
    return db.prepare('SELECT * FROM store_messages WHERE store_id = ? AND media = ? LIMIT 1').get(storeId, media) as StoreMessage | undefined;
  },
};

const ORDER_FIELDS = [
  'number',
  'status',
  'subtotal',
  'delivery_fee',
  'total',
  'delivery_type',
  'recipient_name',
  'phone',
  'address',
  'address_reference',
  'notes',
  'payment_method',
  'payment_status',
  'proof_media',
  'proof_data',
  'status_reason',
  'placed_at',
  'confirmed_at',
  'shipped_at',
  'delivered_at',
  'closed_at',
] as const;
export type OrderPatch = Partial<Pick<StoreOrder, (typeof ORDER_FIELDS)[number]>>;

export interface OrderListRow extends StoreOrder {
  customer_name: string | null;
  customer_phone: string | null;
  customer_jid: string;
  is_simulator: number;
  item_count: number;
}

const ORDER_LIST_SQL = `
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.jid AS customer_jid, c.is_simulator,
         (SELECT COALESCE(SUM(quantity), 0) FROM store_order_items i WHERE i.order_id = o.id) AS item_count
  FROM store_orders o JOIN store_customers c ON c.id = o.customer_id`;

export const storeOrdersModel = {
  get(storeId: number, id: number): StoreOrder | undefined {
    return db.prepare('SELECT * FROM store_orders WHERE store_id = ? AND id = ?').get(storeId, id) as StoreOrder | undefined;
  },

  getRow(storeId: number, id: number): OrderListRow | undefined {
    return db.prepare(`${ORDER_LIST_SQL} WHERE o.store_id = ? AND o.id = ?`).get(storeId, id) as OrderListRow | undefined;
  },

  /** Orders the business sees: everything the customer already confirmed (carts are not orders yet). */
  list(storeId: number, statuses: OrderStatus[] | null, limit = 300): OrderListRow[] {
    const filter = statuses?.length ? `AND o.status IN (${statuses.map(() => '?').join(', ')})` : `AND o.status != 'draft'`;
    return db
      .prepare(`${ORDER_LIST_SQL} WHERE o.store_id = ? ${filter} ORDER BY COALESCE(o.placed_at, o.created_at) DESC LIMIT ?`)
      .all(storeId, ...(statuses ?? []), limit) as OrderListRow[];
  },

  countsByStatus(storeId: number): Record<string, number> {
    const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM store_orders WHERE store_id = ? AND status != 'draft' GROUP BY status`).all(storeId) as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  },

  /** Sales of the orders placed since `sinceWall` that the business accepted. */
  salesSince(storeId: number, sinceWall: string): { orders: number; total: number } {
    return db
      .prepare(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total FROM store_orders
         WHERE store_id = ? AND placed_at >= ? AND status IN ('confirmed', 'shipped', 'delivered')`,
      )
      .get(storeId, sinceWall) as { orders: number; total: number };
  },

  draftOf(customerId: number): StoreOrder | undefined {
    return db.prepare(`SELECT * FROM store_orders WHERE customer_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1`).get(customerId) as StoreOrder | undefined;
  },

  createDraft(storeId: number, customerId: number): StoreOrder {
    const now = nowLocal();
    const id = Number(db.prepare('INSERT INTO store_orders (store_id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(storeId, customerId, now, now).lastInsertRowid);
    return this.get(storeId, id)!;
  },

  recentOfCustomer(customerId: number, limit = 5): StoreOrder[] {
    return db.prepare(`SELECT * FROM store_orders WHERE customer_id = ? AND status != 'draft' ORDER BY id DESC LIMIT ?`).all(customerId, limit) as StoreOrder[];
  },

  update(id: number, patch: OrderPatch): void {
    const { sql, values } = setClause(patch, ORDER_FIELDS);
    if (!sql) return;
    db.prepare(`UPDATE store_orders SET ${sql}, updated_at = ? WHERE id = ?`).run(...values, nowLocal(), id);
  },

  remove(id: number): void {
    db.prepare('DELETE FROM store_orders WHERE id = ?').run(id);
  },

  items(orderId: number): StoreOrderItem[] {
    return db.prepare('SELECT * FROM store_order_items WHERE order_id = ? ORDER BY id').all(orderId) as StoreOrderItem[];
  },

  itemByProduct(orderId: number, productId: number): StoreOrderItem | undefined {
    return db.prepare('SELECT * FROM store_order_items WHERE order_id = ? AND product_id = ?').get(orderId, productId) as StoreOrderItem | undefined;
  },

  addItem(orderId: number, item: Omit<StoreOrderItem, 'id' | 'order_id'>): void {
    db.prepare('INSERT INTO store_order_items (order_id, product_id, name, unit_price, list_price, quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      orderId,
      item.product_id,
      item.name,
      item.unit_price,
      item.list_price,
      item.quantity,
      item.notes,
    );
  },

  updateItem(id: number, patch: { quantity?: number; notes?: string | null; unit_price?: number; list_price?: number; name?: string }): void {
    const { sql, values } = setClause(patch, ['quantity', 'notes', 'unit_price', 'list_price', 'name']);
    if (sql) db.prepare(`UPDATE store_order_items SET ${sql} WHERE id = ?`).run(...values, id);
  },

  removeItem(id: number): void {
    db.prepare('DELETE FROM store_order_items WHERE id = ?').run(id);
  },

  clearItems(orderId: number): void {
    db.prepare('DELETE FROM store_order_items WHERE order_id = ?').run(orderId);
  },

  addEvent(orderId: number, event: string, note: string | null = null, actorUserId: number | null = null): void {
    db.prepare('INSERT INTO store_order_events (order_id, event, note, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(orderId, event, note, actorUserId, nowLocal());
  },

  events(orderId: number): (StoreOrderEvent & { actor_name: string | null })[] {
    return db
      .prepare('SELECT e.*, u.name AS actor_name FROM store_order_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.order_id = ? ORDER BY e.id')
      .all(orderId) as (StoreOrderEvent & { actor_name: string | null })[];
  },
};

export interface AdminNotice {
  wa_message_id: string;
  store_id: number;
  order_id: number;
  user_id: number;
  action: 'confirm' | 'ship';
}

export const storeNoticesModel = {
  add(notice: AdminNotice): void {
    db.prepare('INSERT OR REPLACE INTO store_admin_notices (wa_message_id, store_id, order_id, user_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      notice.wa_message_id,
      notice.store_id,
      notice.order_id,
      notice.user_id,
      notice.action,
      nowLocal(),
    );
  },

  byMessageId(id: string): AdminNotice | undefined {
    return db.prepare('SELECT * FROM store_admin_notices WHERE wa_message_id = ?').get(id) as AdminNotice | undefined;
  },
};
