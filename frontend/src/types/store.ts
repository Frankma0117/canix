/** Order-taking assistant ("Pedidos") - shapes returned by /api/stores (see backend store.routes.ts). */

export interface StoreConnection {
  connection: string;
  connected: boolean;
  hasQr: boolean;
  banSuspected: boolean;
  linked: boolean;
  phone: string | null;
}

export interface Store {
  id: number;
  name: string;
  business_type: string | null;
  description: string | null;
  instructions: string | null;
  assistant_name: string | null;
  welcome_message: string | null;
  hours_text: string | null;
  address: string | null;
  payment_info: string | null;
  accepts_transfer: number;
  accepts_cash: number;
  allows_pickup: number;
  delivery_fee: number;
  free_delivery_from: number | null;
  min_order: number;
  delivery_zones: string | null;
  bot_enabled: number;
  active: number;
  is_demo: number;
  connection: StoreConnection;
  pendingOrders: number;
  humanChats: number;
  products: number;
}

export interface StoresResponse {
  stores: Store[];
  canCreate: boolean;
  /** False when the server has no vision provider: receipts are attached but not read. */
  proofReading: boolean;
}

export interface StoreCategory {
  id: number;
  name: string;
  position: number;
}

export interface StoreProduct {
  id: number;
  category_id: number | null;
  name: string;
  description: string | null;
  details: string | null;
  price: number;
  current_price: number;
  promo_title: string | null;
  image_url: string | null;
  available: number;
  featured: number;
}

export interface StorePromotion {
  id: number;
  title: string;
  description: string | null;
  product_id: number | null;
  product_name: string | null;
  product_price: number | null;
  promo_price: number | null;
  weekdays: number[] | null;
  start_date: string | null;
  end_date: string | null;
  active: number;
  applies_today: boolean;
  /** The promotion's own banner, or the linked product's photo when it has none. */
  image_url: string | null;
  own_image: boolean;
}

export interface CatalogResponse {
  categories: StoreCategory[];
  products: StoreProduct[];
  promotions: StorePromotion[];
}

export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'rejected' | 'cancelled';
export type PaymentStatus = 'pending' | 'proof_received' | 'verified' | 'rejected' | 'on_delivery';

export interface OrderItem {
  id: number;
  name: string;
  unit_price: number;
  list_price: number;
  quantity: number;
  notes: string | null;
}

export interface ProofReading {
  isProof: boolean;
  amount: number | null;
  bank: string | null;
  reference: string | null;
  date: string | null;
  payer: string | null;
  recipient: string | null;
  seen: string | null;
  amountMatches: boolean | null;
}

export interface Order {
  id: number;
  label: string;
  status: OrderStatus;
  subtotal: number;
  delivery_fee: number;
  total: number;
  delivery_type: 'delivery' | 'pickup' | null;
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  address_reference: string | null;
  notes: string | null;
  payment_method: 'transfer' | 'cash' | null;
  payment_status: PaymentStatus;
  status_reason: string | null;
  placed_at: string | null;
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  customer_id: number;
  customer_name: string | null;
  customer_phone: string | null;
  is_simulator: number;
  item_count: number;
  items: OrderItem[];
}

export interface OrderDetail extends Order {
  proof: ProofReading | null;
  proof_url: string | null;
  events: { id: number; event: string; note: string | null; actor_name: string | null; created_at: string }[];
}

export interface OrdersResponse {
  orders: Order[];
  counts: Partial<Record<OrderStatus, number>>;
}

export interface StoreSummary {
  counts: Partial<Record<OrderStatus, number>>;
  today: { orders: number; total: number };
  week: { orders: number; total: number };
  humanChats: number;
  unreadChats: number;
}

export interface Conversation {
  id: number;
  name: string | null;
  phone: string | null;
  jid: string;
  mode: 'bot' | 'human';
  handoff_reason: string | null;
  unread: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  address: string | null;
  open_orders: number;
}

export interface ChatMessage {
  id: number;
  role: 'customer' | 'bot' | 'agent' | 'system';
  kind: 'text' | 'image';
  body: string;
  media_url: string | null;
  internal: number;
  created_at: string;
}

export interface ThreadResponse {
  customer: Conversation | null;
  /** The assistant is working on an answer in this chat. */
  typing: boolean;
  messages: ChatMessage[];
  orders: { id: number; label: string; status: OrderStatus; total: number; placed_at: string | null }[];
}

export interface StoreMember {
  id: number;
  name: string | null;
  phone: string;
  role: 'admin' | 'user';
  notify: boolean;
  hasPassword: boolean;
}
