/** Order-taking assistant ("Pedidos") - see database/schema/store.schema.ts for what each column means. */

/**
 * 'sales' sells products and takes orders (cart, delivery, payment); 'services' sells bookable
 * services and takes appointments (staff, schedule, reminders). They are different businesses with
 * different assistants, menus and screens - see services/store/store-booking*.ts.
 */
export type StoreKind = 'sales' | 'services';

export interface Store {
  id: number;
  name: string;
  kind: StoreKind;
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
  currency: string;
  bot_enabled: number;
  active: number;
  is_demo: number;
  next_order_number: number;
  created_at: string;
  updated_at: string;
}

export interface StoreCategory {
  id: number;
  store_id: number;
  name: string;
  position: number;
}

export interface StoreProduct {
  id: number;
  store_id: number;
  category_id: number | null;
  name: string;
  description: string | null;
  details: string | null;
  price: number;
  image: string | null;
  available: number;
  featured: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface StorePromotion {
  id: number;
  store_id: number;
  title: string;
  description: string | null;
  product_id: number | null;
  promo_price: number | null;
  weekdays: string | null;
  start_date: string | null;
  end_date: string | null;
  image: string | null;
  active: number;
  created_at: string;
}

export type ConversationMode = 'bot' | 'human';

export interface StoreCustomer {
  id: number;
  store_id: number;
  jid: string;
  phone: string | null;
  name: string | null;
  address: string | null;
  address_reference: string | null;
  mode: ConversationMode;
  handoff_reason: string | null;
  handoff_at: string | null;
  unread: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_simulator: number;
  created_at: string;
}

export type StoreMessageRole = 'customer' | 'bot' | 'agent' | 'system';

export interface StoreMessage {
  id: number;
  store_id: number;
  customer_id: number;
  role: StoreMessageRole;
  kind: 'text' | 'image';
  body: string;
  media: string | null;
  internal: number;
  created_at: string;
}

export type OrderStatus = 'draft' | 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'rejected' | 'cancelled';
export type PaymentMethod = 'transfer' | 'cash';
export type PaymentStatus = 'pending' | 'proof_received' | 'verified' | 'rejected' | 'on_delivery';
export type DeliveryType = 'delivery' | 'pickup';

export interface StoreOrder {
  id: number;
  store_id: number;
  customer_id: number;
  number: number | null;
  status: OrderStatus;
  subtotal: number;
  delivery_fee: number;
  total: number;
  delivery_type: DeliveryType | null;
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  address_reference: string | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  proof_media: string | null;
  proof_data: string | null;
  status_reason: string | null;
  created_at: string;
  placed_at: string | null;
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  updated_at: string;
}

export interface StoreOrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  name: string;
  unit_price: number;
  list_price: number;
  quantity: number;
  notes: string | null;
}

export interface StoreOrderEvent {
  id: number;
  order_id: number;
  event: string;
  note: string | null;
  actor_user_id: number | null;
  created_at: string;
}

/** What the vision model read from a transfer receipt (see services/store/payment-proof.service.ts). */
export interface PaymentProofReading {
  isProof: boolean;
  amount: number | null;
  bank: string | null;
  reference: string | null;
  date: string | null;
  payer: string | null;
  recipient: string | null;
  /** What the image shows, in the model's words - also set when it is not a receipt. */
  seen: string | null;
  /** True when the amount read equals the order's total. */
  amountMatches: boolean | null;
}
