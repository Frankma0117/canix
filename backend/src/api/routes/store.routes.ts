import { type Express, type Request } from 'express';
import multer from 'multer';
import qrcode from 'qrcode';
import { requirePanelAdmin, requirePermission } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/security.middleware.js';
import { h, int, str, userId } from '../http-helpers.js';
import {
  storeCatalogModel,
  storeCustomersModel,
  storeMessagesModel,
  storeOrdersModel,
  storesModel,
  type OrderListRow,
  type ProductPatch,
  type PromotionPatch,
  type StorePatch,
} from '../../models/store.model.js';
import { usersModel } from '../../models/users.model.js';
import { addDays, nowLocal, todayLocal } from '../../shared/utils/datetime.js';
import { jidToPhone } from '../../shared/utils/jid.js';
import { addStoreMember, canManageStore, removeStoreMember, storesVisibleTo } from '../../services/store/store-access.service.js';
import { dropStoreSession, storeConnectionStatus, storeSession } from '../../services/store/store-sessions.js';
import {
  MAX_STORE_IMAGE_BYTES,
  deleteStoreImage,
  deleteStoreMedia,
  isPublicMedia,
  mediaPath,
  mimeOfMedia,
  publicMediaUrl,
  saveStoreImage,
} from '../../services/store/store-media.service.js';
import { pricedProducts, promoAppliesOn, promoWeekdays } from '../../services/store/store-pricing.js';
import {
  StoreError,
  cancelOrder,
  confirmOrder,
  deliverOrder,
  orderLabel,
  orderView,
  rejectOrder,
  reviewPayment,
  shipOrder,
} from '../../services/store/store-orders.service.js';
import { handoffToHuman, isCustomerBusy, receiveCustomerMessage, returnToBot, sendAgentMessage } from '../../services/store/store-engine.js';
import { proofReadingAvailable } from '../../services/store/payment-proof.service.js';
import { seedDemoStore } from '../../services/store/store-demo.service.js';
import type { OrderStatus, Store, StoreMessage, StoreProduct, StorePromotion } from '../../entities/index.js';

/**
 * Order-taking assistant ("Pedidos") - /api/stores. Every route below `/:storeId` first resolves
 * the store and checks that the signed-in person manages it (a store that isn't theirs behaves as
 * if it didn't exist). Creating and deleting stores and choosing their people is the
 * administrator's; everything else is shared with the business administrators.
 */

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_STORE_IMAGE_BYTES, files: 1, fields: 10, fieldSize: 20_000 } }).array('files', 1);

function storeOf(req: Request): Store {
  const store = storesModel.get(Number(req.params.storeId));
  if (!store || !canManageStore(req.panelUser!, store.id)) throw new StoreError('Ese negocio no existe.');
  return store;
}

const bool = (v: unknown): number | undefined => (v === undefined ? undefined : v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const money = (v: unknown): number | undefined => {
  const n = int(v);
  return n === undefined ? undefined : Math.max(0, n);
};
/** '' and null clear an optional text field. */
const optText = (v: unknown, max: number): string | null | undefined => (v === undefined ? undefined : str(v, max) || null);
const optDate = (v: unknown): string | null | undefined => (v === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

function uploadedImage(req: Request): Buffer | undefined {
  return (req.files as Express.Multer.File[] | undefined)?.[0]?.buffer;
}

function storeView(store: Store) {
  const counts = storeOrdersModel.countsByStatus(store.id);
  const conversations = storeCustomersModel.conversations(store.id);
  return {
    ...store,
    connection: storeConnectionStatus(store.id),
    pendingOrders: counts.pending ?? 0,
    humanChats: conversations.filter((c) => c.mode === 'human' && !c.is_simulator).length,
    products: storeCatalogModel.products(store.id).length,
  };
}

function productView(storeId: number, product: StoreProduct & { current_price?: number; promo_title?: string | null }) {
  return { ...product, image_url: publicMediaUrl(storeId, product.image), current_price: product.current_price ?? product.price, promo_title: product.promo_title ?? null };
}

function promotionView(storeId: number, promo: StorePromotion, products: StoreProduct[]) {
  const product = promo.product_id ? products.find((p) => p.id === promo.product_id) : undefined;
  return {
    ...promo,
    weekdays: promoWeekdays(promo),
    image_url: publicMediaUrl(storeId, promo.image),
    product_name: product?.name ?? null,
    product_price: product?.price ?? null,
    applies_today: promoAppliesOn(promo),
  };
}

function orderDetail(storeId: number, row: OrderListRow) {
  return {
    ...orderView(row),
    label: orderLabel(row),
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    is_simulator: row.is_simulator,
    item_count: row.item_count,
    proof_url: row.proof_media ? `/api/stores/${storeId}/media/${row.proof_media}` : null,
    events: storeOrdersModel.events(row.id),
  };
}

function messageView(storeId: number, m: StoreMessage) {
  return { ...m, media_url: m.media ? (isPublicMedia(m.media) ? publicMediaUrl(storeId, m.media) : `/api/stores/${storeId}/media/${m.media}`) : null };
}

function storePatchOf(body: Record<string, unknown>, isAdmin: boolean): StorePatch {
  const patch: StorePatch = {
    name: body.name === undefined ? undefined : str(body.name, 80) || undefined,
    business_type: optText(body.business_type, 80),
    description: optText(body.description, 600),
    instructions: optText(body.instructions, 6000),
    assistant_name: optText(body.assistant_name, 40),
    welcome_message: optText(body.welcome_message, 600),
    hours_text: optText(body.hours_text, 300),
    address: optText(body.address, 200),
    payment_info: optText(body.payment_info, 800),
    accepts_transfer: bool(body.accepts_transfer),
    accepts_cash: bool(body.accepts_cash),
    allows_pickup: bool(body.allows_pickup),
    delivery_fee: money(body.delivery_fee),
    free_delivery_from: body.free_delivery_from === undefined ? undefined : body.free_delivery_from === null || body.free_delivery_from === '' ? null : money(body.free_delivery_from),
    min_order: money(body.min_order),
    delivery_zones: optText(body.delivery_zones, 600),
    bot_enabled: bool(body.bot_enabled),
  };
  if (isAdmin) patch.active = bool(body.active);
  return patch;
}

export function registerStoreRoutes(app: Express): void {
  // Product and promotion photos: public by design (see services/store/store-media.service.ts).
  app.get('/media/store/:storeId/:file', (req, res) => {
    const file = String(req.params.file);
    const path = isPublicMedia(file) ? mediaPath(Number(req.params.storeId), file) : null;
    if (!path) return void res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.type(mimeOfMedia(file)).sendFile(path);
  });

  app.use('/api/stores', requirePermission('store.manage'));

  // ---------------------------------------------------------------- stores
  app.get(
    '/api/stores',
    h((req, res) => res.json({ stores: storesVisibleTo(req.panelUser!).map(storeView), canCreate: req.panelUser!.role === 'admin', proofReading: proofReadingAvailable() })),
  );

  app.post(
    '/api/stores',
    requirePanelAdmin,
    h((req, res) => {
      const name = str(req.body?.name, 80);
      if (!name) throw new StoreError('Ponle un nombre al negocio.');
      const store = storesModel.create({ ...storePatchOf(req.body ?? {}, true), name });
      res.status(201).json({ id: store.id });
    }),
  );

  /** A ready-to-try business with catalog, photos and promotions (see store-demo.service.ts). */
  app.post(
    '/api/stores/demo',
    requirePanelAdmin,
    h(async (req, res) => {
      const store = await seedDemoStore(userId(req));
      res.status(201).json({ id: store.id });
    }),
  );

  app.get('/api/stores/:storeId', h((req, res) => res.json(storeView(storeOf(req)))));

  app.patch(
    '/api/stores/:storeId',
    h((req, res) => {
      const store = storeOf(req);
      storesModel.update(store.id, storePatchOf(req.body ?? {}, req.panelUser!.role === 'admin'));
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/stores/:storeId',
    requirePanelAdmin,
    h(async (req, res) => {
      const store = storeOf(req);
      await dropStoreSession(store.id);
      for (const member of storesModel.members(store.id)) removeStoreMember(store.id, member.id, userId(req));
      storesModel.remove(store.id);
      await deleteStoreMedia(store.id);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/stores/:storeId/summary',
    h((req, res) => {
      const store = storeOf(req);
      const today = todayLocal();
      const conversations = storeCustomersModel.conversations(store.id);
      res.json({
        counts: storeOrdersModel.countsByStatus(store.id),
        today: storeOrdersModel.salesSince(store.id, `${today} 00:00:00`),
        week: storeOrdersModel.salesSince(store.id, addDays(`${today} 00:00:00`, -6)),
        humanChats: conversations.filter((c) => c.mode === 'human' && !c.is_simulator).length,
        unreadChats: conversations.filter((c) => c.unread > 0 && !c.is_simulator).length,
      });
    }),
  );

  // ---------------------------------------------------------------- people of the business (administrator)
  app.get(
    '/api/stores/:storeId/members',
    h((req, res) => {
      const store = storeOf(req);
      res.json(storesModel.members(store.id).map((m) => ({ id: m.id, name: m.name, phone: jidToPhone(m.jid) ?? m.jid.split('@')[0], role: m.role, notify: !!m.notify, hasPassword: !!m.has_password })));
    }),
  );

  app.post(
    '/api/stores/:storeId/members',
    requirePanelAdmin,
    h(async (req, res) => {
      const store = storeOf(req);
      const added = await addStoreMember(store.id, { phone: String(req.body?.phone ?? ''), name: str(req.body?.name, 80) }, userId(req));
      res.status(201).json({ id: added.user.id, created: added.created, temporaryPassword: added.temporaryPassword, loginId: jidToPhone(added.user.jid) ?? added.user.jid.split('@')[0] });
    }),
  );

  app.patch(
    '/api/stores/:storeId/members/:userId',
    h((req, res) => {
      const store = storeOf(req);
      const target = Number(req.params.userId);
      // Everyone decides about their own notices; the administrator, about anyone's.
      if (req.panelUser!.role !== 'admin' && target !== userId(req)) throw new StoreError('Solo puedes cambiar tus propios avisos.');
      storesModel.setMemberNotify(store.id, target, !!req.body?.notify);
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/stores/:storeId/members/:userId',
    requirePanelAdmin,
    h((req, res) => {
      const store = storeOf(req);
      removeStoreMember(store.id, Number(req.params.userId), userId(req));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- the store's own WhatsApp number
  app.get('/api/stores/:storeId/connection', h((req, res) => res.json(storeConnectionStatus(storeOf(req).id))));

  app.get(
    '/api/stores/:storeId/connection/qr',
    h(async (req, res) => {
      const wa = storeSession(storeOf(req).id);
      if (!wa.qr) return void res.status(404).json({ error: 'No hay QR disponible.' });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(await qrcode.toBuffer(wa.qr, { width: 320, margin: 1 }));
    }),
  );

  /** Starts (or re-establishes) the session: shows a QR when the number isn't linked yet. */
  app.post(
    '/api/stores/:storeId/connection/connect',
    h(async (req, res) => {
      const store = storeOf(req);
      if (!store.active) throw new StoreError('Este negocio está desactivado.');
      await storeSession(store.id).reconnect();
      res.json({ ok: true });
    }),
  );

  /** Unlinks the number (its credentials are deleted); "Conectar" then shows a new QR. */
  app.post(
    '/api/stores/:storeId/connection/unlink',
    h(async (req, res) => {
      await dropStoreSession(storeOf(req).id);
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- catalog
  app.get(
    '/api/stores/:storeId/catalog',
    h((req, res) => {
      const store = storeOf(req);
      const products = pricedProducts(store.id);
      res.json({
        categories: storeCatalogModel.categories(store.id),
        products: products.map((p) => productView(store.id, p)),
        promotions: storeCatalogModel.promotions(store.id).map((p) => promotionView(store.id, p, products)),
      });
    }),
  );

  app.post(
    '/api/stores/:storeId/categories',
    h((req, res) => {
      const name = str(req.body?.name, 60);
      if (!name) throw new StoreError('Ponle un nombre a la categoría.');
      res.status(201).json({ id: storeCatalogModel.createCategory(storeOf(req).id, name) });
    }),
  );

  app.patch(
    '/api/stores/:storeId/categories/:id',
    h((req, res) => {
      storeCatalogModel.updateCategory(storeOf(req).id, Number(req.params.id), { name: str(req.body?.name, 60) || undefined, position: int(req.body?.position) });
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/stores/:storeId/categories/:id',
    h((req, res) => {
      storeCatalogModel.removeCategory(storeOf(req).id, Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  function productPatchOf(storeId: number, body: Record<string, unknown>): ProductPatch {
    const categoryId = body.category_id === undefined ? undefined : body.category_id === null || body.category_id === '' ? null : int(body.category_id);
    if (categoryId && !storeCatalogModel.category(storeId, categoryId)) throw new StoreError('Esa categoría no existe.');
    return {
      category_id: categoryId,
      name: body.name === undefined ? undefined : str(body.name, 120) || undefined,
      description: optText(body.description, 500),
      details: optText(body.details, 1500),
      price: money(body.price),
      available: bool(body.available),
      featured: bool(body.featured),
    };
  }

  app.post(
    '/api/stores/:storeId/products',
    h((req, res) => {
      const store = storeOf(req);
      const patch = productPatchOf(store.id, req.body ?? {});
      if (!patch.name) throw new StoreError('Ponle un nombre al producto.');
      if (patch.price === undefined) throw new StoreError('Ponle un precio al producto.');
      res.status(201).json({ id: storeCatalogModel.createProduct(store.id, { ...patch, name: patch.name, price: patch.price }) });
    }),
  );

  app.patch(
    '/api/stores/:storeId/products/:id',
    h((req, res) => {
      const store = storeOf(req);
      if (!storeCatalogModel.product(store.id, Number(req.params.id))) throw new StoreError('Ese producto no existe.');
      storeCatalogModel.updateProduct(store.id, Number(req.params.id), productPatchOf(store.id, req.body ?? {}));
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/stores/:storeId/products/:id',
    h(async (req, res) => {
      const store = storeOf(req);
      const product = storeCatalogModel.product(store.id, Number(req.params.id));
      if (product) {
        storeCatalogModel.removeProduct(store.id, product.id);
        await deleteStoreImage(store.id, product.image);
      }
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/stores/:storeId/products/:id/image',
    imageUpload,
    h(async (req, res) => {
      const store = storeOf(req);
      const product = storeCatalogModel.product(store.id, Number(req.params.id));
      const image = uploadedImage(req);
      if (!product) throw new StoreError('Ese producto no existe.');
      if (!image) throw new StoreError('No llegó ninguna imagen.');
      const file = await saveStoreImage(store.id, image, 'public');
      storeCatalogModel.updateProduct(store.id, product.id, { image: file });
      await deleteStoreImage(store.id, product.image);
      res.json({ image_url: publicMediaUrl(store.id, file) });
    }),
  );

  app.delete(
    '/api/stores/:storeId/products/:id/image',
    h(async (req, res) => {
      const store = storeOf(req);
      const product = storeCatalogModel.product(store.id, Number(req.params.id));
      if (product?.image) {
        storeCatalogModel.updateProduct(store.id, product.id, { image: null });
        await deleteStoreImage(store.id, product.image);
      }
      res.json({ ok: true });
    }),
  );

  function promotionPatchOf(storeId: number, body: Record<string, unknown>): PromotionPatch {
    const productId = body.product_id === undefined ? undefined : body.product_id === null || body.product_id === '' ? null : int(body.product_id);
    if (productId && !storeCatalogModel.product(storeId, productId)) throw new StoreError('Ese producto no existe.');
    const weekdays = Array.isArray(body.weekdays) ? body.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : null;
    return {
      title: body.title === undefined ? undefined : str(body.title, 120) || undefined,
      description: optText(body.description, 500),
      product_id: productId,
      promo_price: body.promo_price === undefined ? undefined : body.promo_price === null || body.promo_price === '' ? null : money(body.promo_price),
      weekdays: body.weekdays === undefined ? undefined : weekdays && weekdays.length && weekdays.length < 7 ? JSON.stringify([...new Set(weekdays)].sort()) : null,
      start_date: optDate(body.start_date),
      end_date: optDate(body.end_date),
      active: bool(body.active),
    };
  }

  app.post(
    '/api/stores/:storeId/promotions',
    h((req, res) => {
      const store = storeOf(req);
      const patch = promotionPatchOf(store.id, req.body ?? {});
      if (!patch.title) throw new StoreError('Ponle un título a la promoción.');
      res.status(201).json({ id: storeCatalogModel.createPromotion(store.id, { ...patch, title: patch.title }) });
    }),
  );

  app.patch(
    '/api/stores/:storeId/promotions/:id',
    h((req, res) => {
      const store = storeOf(req);
      if (!storeCatalogModel.promotion(store.id, Number(req.params.id))) throw new StoreError('Esa promoción no existe.');
      storeCatalogModel.updatePromotion(store.id, Number(req.params.id), promotionPatchOf(store.id, req.body ?? {}));
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/stores/:storeId/promotions/:id',
    h((req, res) => {
      storeCatalogModel.removePromotion(storeOf(req).id, Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- orders
  const STATUSES: OrderStatus[] = ['pending', 'confirmed', 'shipped', 'delivered', 'rejected', 'cancelled'];

  app.get(
    '/api/stores/:storeId/orders',
    h((req, res) => {
      const store = storeOf(req);
      const wanted = String(req.query.status ?? '')
        .split(',')
        .filter((s): s is OrderStatus => STATUSES.includes(s as OrderStatus));
      res.json({
        orders: storeOrdersModel.list(store.id, wanted.length ? wanted : null).map((o) => ({ ...o, label: orderLabel(o), items: storeOrdersModel.items(o.id) })),
        counts: storeOrdersModel.countsByStatus(store.id),
      });
    }),
  );

  app.get(
    '/api/stores/:storeId/orders/:id',
    h((req, res) => {
      const store = storeOf(req);
      const row = storeOrdersModel.getRow(store.id, Number(req.params.id));
      if (!row || row.status === 'draft') throw new StoreError('Ese pedido no existe.');
      res.json(orderDetail(store.id, row));
    }),
  );

  const orderAction = (path: string, run: (storeId: number, orderId: number, actor: number, req: Request) => Promise<OrderListRow>) =>
    app.post(
      `/api/stores/:storeId/orders/:id/${path}`,
      h(async (req, res) => {
        const store = storeOf(req);
        res.json(orderDetail(store.id, await run(store.id, Number(req.params.id), userId(req), req)));
      }),
    );
  const reason = (req: Request) => str(req.body?.reason, 300) || null;

  orderAction('confirm', (s, o, a) => confirmOrder(s, o, a));
  orderAction('reject', (s, o, a, req) => rejectOrder(s, o, a, reason(req)));
  orderAction('ship', (s, o, a) => shipOrder(s, o, a));
  orderAction('deliver', (s, o, a) => deliverOrder(s, o, a));
  orderAction('cancel', (s, o, a, req) => cancelOrder(s, o, a, reason(req)));
  orderAction('payment', (s, o, a, req) => {
    const verdict = req.body?.status;
    if (verdict !== 'verified' && verdict !== 'rejected') throw new StoreError('Indica si el pago queda verificado o rechazado.');
    return reviewPayment(s, o, a, verdict, reason(req));
  });

  /** What customers sent (payment receipts, other photos): only for the people of that store. */
  app.get(
    '/api/stores/:storeId/media/:file',
    h((req, res) => {
      const store = storeOf(req);
      const file = String(req.params.file);
      const path = mediaPath(store.id, file);
      if (!path) return void res.status(404).json({ error: 'Esa imagen ya no está.' });
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.type(mimeOfMedia(file)).sendFile(path);
    }),
  );

  // ---------------------------------------------------------------- conversations
  app.get(
    '/api/stores/:storeId/conversations',
    h((req, res) => {
      const store = storeOf(req);
      res.json(storeCustomersModel.conversations(store.id).filter((c) => !c.is_simulator));
    }),
  );

  const customerOf = (req: Request, storeId: number) => {
    const customer = storeCustomersModel.get(storeId, Number(req.params.customerId));
    if (!customer) throw new StoreError('Esa conversación no existe.');
    return customer;
  };

  app.get(
    '/api/stores/:storeId/conversations/:customerId/messages',
    h((req, res) => {
      const store = storeOf(req);
      const customer = customerOf(req, store.id);
      const messages = storeMessagesModel.list(customer.id, int(req.query.after) ?? 0);
      if (customer.unread) storeCustomersModel.markRead(customer.id);
      res.json({
        customer: storeCustomersModel.get(store.id, customer.id),
        typing: isCustomerBusy(customer.id),
        messages: messages.map((m) => messageView(store.id, m)),
        orders: storeOrdersModel.recentOfCustomer(customer.id, 5).map((o) => ({ id: o.id, label: orderLabel(o), status: o.status, total: o.total, placed_at: o.placed_at })),
      });
    }),
  );

  app.post(
    '/api/stores/:storeId/conversations/:customerId/messages',
    rateLimit({ capacity: 40, windowMs: 60_000, keyFn: (req) => `store-msg:${req.panelUser?.id}` }),
    h(async (req, res) => {
      const store = storeOf(req);
      const customer = customerOf(req, store.id);
      const text = str(req.body?.text, 2000);
      if (!text) throw new StoreError('Escribe un mensaje.');
      await sendAgentMessage(customer, text);
      res.json({ ok: true });
    }),
  );

  /** 'human' = a person takes the chat (the assistant goes quiet); 'bot' = give it back. */
  app.post(
    '/api/stores/:storeId/conversations/:customerId/mode',
    h(async (req, res) => {
      const store = storeOf(req);
      const customer = customerOf(req, store.id);
      if (req.body?.mode === 'bot') returnToBot(customer);
      else if (req.body?.mode === 'human') {
        if (customer.mode !== 'human') {
          storeCustomersModel.setMode(customer.id, 'human', 'Tomada desde el portal.');
          storeMessagesModel.add(customer, { role: 'system', body: `🙋 ${usersModel.getById(userId(req))?.name ?? 'Una persona'} tomó la conversación: el asistente queda en pausa en este chat.`, internal: true });
        }
      } else throw new StoreError('Modo inválido.');
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- test chat ("Probar el bot")
  // The signed-in person plays the customer: same assistant, same orders, nothing goes to WhatsApp.
  const simulatorJid = (req: Request) => `sim-${userId(req)}@simulator`;

  app.get(
    '/api/stores/:storeId/simulator',
    h((req, res) => {
      const store = storeOf(req);
      const customer = storeCustomersModel.byJid(store.id, simulatorJid(req));
      res.json({
        customer: customer ?? null,
        typing: customer ? isCustomerBusy(customer.id) : false,
        messages: customer ? storeMessagesModel.list(customer.id, int(req.query.after) ?? 0).map((m) => messageView(store.id, m)) : [],
        orders: customer ? storeOrdersModel.recentOfCustomer(customer.id, 5).map((o) => ({ id: o.id, label: orderLabel(o), status: o.status, total: o.total, placed_at: o.placed_at })) : [],
      });
    }),
  );

  app.post(
    '/api/stores/:storeId/simulator/message',
    rateLimit({ capacity: 30, windowMs: 60_000, keyFn: (req) => `store-sim:${req.panelUser?.id}` }),
    imageUpload,
    h(async (req, res) => {
      const store = storeOf(req);
      const text = str(req.body?.text, 2000) ?? '';
      const image = uploadedImage(req);
      if (!text && !image) throw new StoreError('Escribe un mensaje o adjunta una imagen.');
      const customer = storeCustomersModel.upsert(store.id, { jid: simulatorJid(req), name: null, isSimulator: true });
      // The request's own 30 s limit is shorter than a slow AI turn: answer as soon as the message
      // is in, the portal polls for the assistant's reply.
      void receiveCustomerMessage(store, customer, { text, image }).catch((err) => console.error('[STORE] Test chat failed:', (err as Error).message));
      res.json({ ok: true, customerId: customer.id });
    }),
  );

  app.post(
    '/api/stores/:storeId/simulator/handoff',
    h(async (req, res) => {
      const store = storeOf(req);
      const customer = storeCustomersModel.byJid(store.id, simulatorJid(req));
      if (customer) {
        if (req.body?.mode === 'bot') returnToBot(customer);
        else await handoffToHuman(store, customer, 'Prueba desde el portal.');
      }
      res.json({ ok: true });
    }),
  );

  /** Starts the test chat over: its conversation and its test orders are deleted. */
  app.post(
    '/api/stores/:storeId/simulator/reset',
    h((req, res) => {
      const store = storeOf(req);
      const customer = storeCustomersModel.byJid(store.id, simulatorJid(req));
      if (customer) storeCustomersModel.remove(customer.id);
      res.json({ ok: true, at: nowLocal() });
    }),
  );
}
