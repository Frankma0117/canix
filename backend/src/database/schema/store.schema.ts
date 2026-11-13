import type Database from 'better-sqlite3';

/**
 * Order-taking assistant ("Pedidos") schema - a business (store) with its OWN WhatsApp number,
 * catalog, promotions, customers, conversations and orders. See services/store/.
 *
 * - A store is managed by its members (Canix users with `store.manage`); the administrator manages
 *   every store. Customers are NOT Canix users: they are whoever writes to the store's number.
 * - Money is whole units of the store's currency (COP has no cents) in INTEGER columns.
 * - Timestamps are wall-clock 'YYYY-MM-DD HH:mm:ss' strings in env.timezone, like everywhere else.
 */
export function initStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      business_type TEXT,
      description TEXT,
      -- How the assistant must attend people: the business owner's own specification, in their words.
      instructions TEXT,
      assistant_name TEXT,
      welcome_message TEXT,
      hours_text TEXT,
      address TEXT,
      -- Where customers pay (bank / Nequi / Daviplata accounts...), shown when they choose transfer.
      payment_info TEXT,
      accepts_transfer INTEGER NOT NULL DEFAULT 1 CHECK (accepts_transfer IN (0, 1)),
      accepts_cash INTEGER NOT NULL DEFAULT 1 CHECK (accepts_cash IN (0, 1)),
      allows_pickup INTEGER NOT NULL DEFAULT 1 CHECK (allows_pickup IN (0, 1)),
      delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
      free_delivery_from INTEGER CHECK (free_delivery_from IS NULL OR free_delivery_from >= 0),
      min_order INTEGER NOT NULL DEFAULT 0 CHECK (min_order >= 0),
      delivery_zones TEXT,
      currency TEXT NOT NULL DEFAULT 'COP',
      bot_enabled INTEGER NOT NULL DEFAULT 1 CHECK (bot_enabled IN (0, 1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
      next_order_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_members (
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Gets the WhatsApp notices (new order, payment proof, a customer asking for a person).
      notify INTEGER NOT NULL DEFAULT 1 CHECK (notify IN (0, 1)),
      created_at TEXT NOT NULL,
      PRIMARY KEY (store_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_members_user ON store_members(user_id);

    CREATE TABLE IF NOT EXISTS store_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_store_categories_store ON store_categories(store_id, position);

    CREATE TABLE IF NOT EXISTS store_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES store_categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      description TEXT,
      -- Anything else worth knowing: ingredients, sizes, presentation, warranty...
      details TEXT,
      price INTEGER NOT NULL CHECK (price >= 0),
      -- File name under the store's media folder (see services/store/store-media.service.ts).
      image TEXT,
      available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
      featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_products_store ON store_products(store_id, category_id, position);

    -- "Promociones del día": a special price for a product, or a free-text offer, on given weekdays
    -- and/or between two dates. Both NULL = every day while active.
    CREATE TABLE IF NOT EXISTS store_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      description TEXT,
      product_id INTEGER REFERENCES store_products(id) ON DELETE CASCADE,
      promo_price INTEGER CHECK (promo_price IS NULL OR promo_price >= 0),
      -- JSON array of weekdays (0 = Sunday .. 6 = Saturday), NULL = all.
      weekdays TEXT,
      start_date TEXT,
      end_date TEXT,
      image TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_promotions_store ON store_promotions(store_id, active);

    -- A customer = one WhatsApp chat with the store's number. The conversation state lives here too.
    CREATE TABLE IF NOT EXISTS store_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      -- The chat to reply to (phone jid or @lid); 'sim-<userId>@simulator' for the portal's test chat.
      jid TEXT NOT NULL,
      phone TEXT,
      name TEXT,
      address TEXT,
      address_reference TEXT,
      -- 'bot' = the assistant answers; 'human' = a person took over (the assistant stays silent).
      mode TEXT NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human')),
      handoff_reason TEXT,
      handoff_at TEXT,
      unread INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      last_message_preview TEXT,
      is_simulator INTEGER NOT NULL DEFAULT 0 CHECK (is_simulator IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE (store_id, jid)
    );
    CREATE INDEX IF NOT EXISTS idx_store_customers_recent ON store_customers(store_id, last_message_at);

    CREATE TABLE IF NOT EXISTS store_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
      -- customer = what they wrote; bot = the assistant; agent = a person of the business;
      -- system = a notice of the order flow ("tu pedido fue confirmado") or an internal note.
      role TEXT NOT NULL CHECK (role IN ('customer', 'bot', 'agent', 'system')),
      kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image')),
      body TEXT NOT NULL DEFAULT '',
      media TEXT,
      -- Internal notes are shown to the business only and never sent to the customer.
      internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_messages_customer ON store_messages(customer_id, id);

    CREATE TABLE IF NOT EXISTS store_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
      -- Per-store consecutive number, assigned when the customer confirms (NULL while a cart).
      number INTEGER,
      -- draft = cart being built with the assistant; pending = confirmed by the customer, waiting
      -- for the business; confirmed -> shipped -> delivered; rejected (by the business); cancelled.
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'confirmed', 'shipped', 'delivered', 'rejected', 'cancelled')),
      subtotal INTEGER NOT NULL DEFAULT 0,
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      delivery_type TEXT CHECK (delivery_type IS NULL OR delivery_type IN ('delivery', 'pickup')),
      recipient_name TEXT,
      phone TEXT,
      address TEXT,
      address_reference TEXT,
      notes TEXT,
      payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('transfer', 'cash')),
      -- pending = nothing yet; proof_received = the customer sent a transfer receipt (to review);
      -- verified / rejected = the business' verdict; on_delivery = pays in cash when it arrives.
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'proof_received', 'verified', 'rejected', 'on_delivery')),
      proof_media TEXT,
      -- JSON: what the vision model read from the receipt (amount, bank, reference, date...).
      proof_data TEXT,
      status_reason TEXT,
      created_at TEXT NOT NULL,
      placed_at TEXT,
      confirmed_at TEXT,
      shipped_at TEXT,
      delivered_at TEXT,
      closed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_orders_store ON store_orders(store_id, status, placed_at);
    CREATE INDEX IF NOT EXISTS idx_store_orders_customer ON store_orders(customer_id, status);

    CREATE TABLE IF NOT EXISTS store_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES store_products(id) ON DELETE SET NULL,
      -- Name and price are copied at the moment of ordering: later catalog edits never change an order.
      name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      list_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON store_order_items(order_id);

    CREATE TABLE IF NOT EXISTS store_order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      note TEXT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_store_order_events_order ON store_order_events(order_id, id);

    -- WhatsApp notices sent to the business' people, so a 👍 / 👎 on one acts on its order.
    CREATE TABLE IF NOT EXISTS store_admin_notices (
      wa_message_id TEXT PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- What a 👍 does: 'confirm' the order (👎 rejects it) or mark it 'ship'ped.
      action TEXT NOT NULL CHECK (action IN ('confirm', 'ship')),
      created_at TEXT NOT NULL
    );
  `);
}
