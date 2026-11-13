import { readFile } from 'node:fs/promises';
import { fromRoot } from '../../config/paths.js';
import { storeCatalogModel, storesModel } from '../../models/store.model.js';
import { saveStoreImage } from './store-media.service.js';
import { StoreError } from './store-orders.service.js';
import type { Store } from '../../entities/index.js';

/**
 * A complete example business to try the order-taking assistant end to end: a burger place with
 * its service specification, categories, products with real photos (backend/assets/store-demo,
 * see CREDITS.md there) and promotions for every day of the week. Created from the portal
 * (Negocios -> "Crear negocio demo"); everything in it can be edited or deleted like any store.
 */
const DEMO_ASSETS = fromRoot('backend', 'assets', 'store-demo');

interface DemoProduct {
  key: string;
  name: string;
  price: number;
  description: string;
  details?: string;
  featured?: boolean;
}

const CATALOG: { category: string; products: DemoProduct[] }[] = [
  {
    category: 'Hamburguesas',
    products: [
      { key: 'clasica', name: 'Hamburguesa Clásica', price: 18000, description: '150 g de carne de res a la parrilla, queso cheddar, lechuga, tomate, cebolla y salsa de la casa.', details: 'Pan brioche. Se puede pedir sin cebolla, sin tomate o sin salsas. Término tres cuartos por defecto.', featured: true },
      { key: 'doble', name: 'Hamburguesa Doble Carne', price: 25000, description: 'Dos carnes de 150 g, doble queso cheddar, pepinillos y salsa de la casa.', details: 'Pan brioche. La más pedida. Se puede pedir sin pepinillos.', featured: true },
      { key: 'bbq', name: 'Hamburguesa BBQ Tocineta', price: 24000, description: 'Carne de 150 g, tocineta crocante, queso cheddar, aros de cebolla y salsa BBQ ahumada.', details: 'Pan brioche. Contiene cerdo.' },
      { key: 'veggie', name: 'Hamburguesa Veggie', price: 20000, description: 'Medallón de lentejas y quinua, queso, lechuga, tomate y guacamole.', details: 'Vegetariana. Se puede pedir sin queso (vegana, el pan no lleva huevo ni leche).' },
    ],
  },
  {
    category: 'Perros y salchipapas',
    products: [
      { key: 'perro', name: 'Perro Caliente Especial', price: 15000, description: 'Salchicha americana, queso derretido, papitas trituradas, tocineta y salsas.', details: 'Se puede pedir sencillo (sin tocineta) por el mismo precio.' },
      { key: 'salchipapa', name: 'Salchipapa Brasa', price: 19000, description: 'Papas a la francesa, salchicha, queso fundido, maíz tierno y salsas de la casa. Para compartir entre dos.' },
    ],
  },
  {
    category: 'Acompañamientos',
    products: [
      { key: 'papas', name: 'Papas a la Francesa', price: 7000, description: 'Porción de papas crocantes con sal de la casa.' },
      { key: 'aros', name: 'Aros de Cebolla', price: 8000, description: 'Ocho aros de cebolla apanados con salsa tártara.' },
      { key: 'nuggets', name: 'Nuggets de Pollo', price: 12000, description: 'Seis nuggets de pechuga apanados y crocantes con salsa BBQ o miel mostaza.', details: 'Indicar la salsa. Porción de 12 unidades: pedir dos porciones.' },
    ],
  },
  {
    category: 'Bebidas',
    products: [
      { key: 'gaseosa', name: 'Gaseosa 400 ml', price: 4500, description: 'Coca-Cola, Coca-Cola sin azúcar, Sprite o Quatro.', details: 'Indicar el sabor. Por defecto se envía Coca-Cola original.' },
      { key: 'limonada', name: 'Limonada Natural', price: 6000, description: 'Limonada natural de 16 oz, con o sin azúcar.', details: 'También de coco por $2.000 más: en ese caso pasar con una persona.' },
      { key: 'malteada', name: 'Malteada de Chocolate', price: 11000, description: 'Malteada cremosa de 16 oz con helado de vainilla y salsa de chocolate.' },
    ],
  },
  {
    category: 'Postres y combos',
    products: [
      { key: 'helado', name: 'Copa de Helado de Chocolate', price: 8000, description: 'Tres bolas de helado de chocolate con salsa de chocolate.' },
      { key: 'combo', name: 'Combo Brasa (hamburguesa clásica + papas + gaseosa)', price: 26000, description: 'Hamburguesa Clásica, porción de papas a la francesa y gaseosa de 400 ml. Ahorras $3.500.', featured: true },
    ],
  },
];

const INSTRUCTIONS = `Saluda con buena energía y tutea al cliente: "¡Hola! Bienvenido a Brasa Burger 🍔". Habla como un mesero amable de barrio, en mensajes cortos.

Orden de atención:
1. Si no sabe qué pedir, cuéntale la promoción del día y ofrécele enviarle el menú.
2. Con cada hamburguesa ofrece UNA sola vez agregar papas y bebida, o cambiarla por el Combo Brasa si pide la Clásica con papas y gaseosa (le sale más barato).
3. Cuando ya no quiera nada más, pregunta si es a domicilio o para recoger y pide los datos de entrega en un solo mensaje.
4. Pregunta cómo paga: Nequi/transferencia o efectivo contra entrega. Si paga en efectivo, pregunta con cuánto paga para llevarle el cambio y anótalo en las observaciones.
5. Muéstrale el resumen con el total y pídele que confirme.

Políticas:
- Los domicilios se demoran entre 35 y 50 minutos según la zona. No prometas menos.
- No se hacen cambios de ingredientes entre hamburguesas, solo se quitan ingredientes.
- Si pregunta por alergias (gluten, lactosa, maní) dile lo que aparece en los detalles del producto y, si no es claro, pásalo con una persona.
- Pedidos de más de 10 hamburguesas o eventos: pásalo con una persona.`;

/** Promotions for each weekday, so there is always a "promoción del día" to try. */
const PROMOS: { title: string; description: string; product: string; price: number; weekdays: number[] }[] = [
  { title: 'Lunes y martes de Doble', description: 'La Hamburguesa Doble Carne a precio de sencilla.', product: 'doble', price: 20000, weekdays: [1, 2] },
  { title: 'Miércoles de Nuggets', description: 'Nuggets de pollo con descuento todo el día.', product: 'nuggets', price: 9000, weekdays: [3] },
  { title: 'Jueves BBQ', description: 'La BBQ Tocineta con $4.000 de descuento.', product: 'bbq', price: 20000, weekdays: [4] },
  { title: 'Fin de semana de Combo Brasa', description: 'Combo Brasa (clásica + papas + gaseosa) a precio especial viernes, sábado y domingo.', product: 'combo', price: 23000, weekdays: [5, 6, 0] },
  { title: 'Malteada feliz', description: 'Malteada de chocolate en promoción todos los días.', product: 'malteada', price: 9000, weekdays: [0, 1, 2, 3, 4, 5, 6] },
];

export async function seedDemoStore(actorId: number): Promise<Store> {
  if (storesModel.getDemo()) throw new StoreError('Ya existe un negocio demo. Bórralo primero si quieres crearlo de nuevo.');

  const store = storesModel.create({
    name: 'Brasa Burger (demo)',
    is_demo: 1,
    business_type: 'Hamburguesería con domicilios',
    description: 'Hamburguesas a la parrilla, perros y salchipapas con domicilio en la ciudad.',
    assistant_name: 'Brasi',
    instructions: INSTRUCTIONS,
    hours_text: 'Todos los días de 12:00 m. a 10:00 p. m.',
    address: 'Calle 45 # 27-18, local 2',
    payment_info: 'Nequi o Daviplata 300 123 4567 a nombre de Brasa Burger SAS · Bancolombia ahorros 123-456789-01',
    delivery_fee: 5000,
    free_delivery_from: 60000,
    min_order: 15000,
    delivery_zones: 'Toda la zona urbana. Veredas y municipios vecinos: consultar con una persona.',
  });
  // Whoever creates it manages it (and gets its WhatsApp notices) - without becoming less of an admin.
  storesModel.addMember(store.id, actorId);

  const productIds = new Map<string, number>();
  for (const group of CATALOG) {
    const categoryId = storeCatalogModel.createCategory(store.id, group.category);
    for (const p of group.products) {
      let image: string | null = null;
      try {
        image = await saveStoreImage(store.id, await readFile(fromRoot(DEMO_ASSETS, `${p.key}.jpg`)), 'public');
      } catch (err) {
        console.error('[STORE] Demo photo "%s" could not be loaded:', p.key, (err as Error).message);
      }
      const id = storeCatalogModel.createProduct(store.id, {
        name: p.name,
        price: p.price,
        category_id: categoryId,
        description: p.description,
        details: p.details ?? null,
        featured: p.featured ? 1 : 0,
        image,
      });
      productIds.set(p.key, id);
    }
  }
  for (const promo of PROMOS) {
    storeCatalogModel.createPromotion(store.id, {
      title: promo.title,
      description: promo.description,
      product_id: productIds.get(promo.product) ?? null,
      promo_price: promo.price,
      weekdays: promo.weekdays.length === 7 ? null : JSON.stringify([...promo.weekdays].sort()),
    });
  }
  console.log('[STORE] Demo store #%d created with %d products.', store.id, productIds.size);
  return storesModel.get(store.id)!;
}
