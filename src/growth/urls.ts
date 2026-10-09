import { env } from '../config/env.js';

/** Public URLs of the product - kept import-free (no demo/routes) so anything can use them. */

export const LANDING_PATH = '/conoce';
/** The portal/admin SPA under the product's own domain: canix.cania.app/app (sales page at "/"). */
export const PORTAL_PATH = '/app';

/** Public link to the portal/admin (what WhatsApp messages point people to). */
export function portalUrl(): string {
  if (env.growth.landingUrl) return `${env.growth.landingUrl}${PORTAL_PATH}`;
  return env.panelUrl.replace(/\/$/, '');
}

/** The canonical public URL of the sales page (LANDING_URL, or <PANEL_URL>/conoce as fallback). */
export function landingUrl(): string {
  if (env.growth.landingUrl) return env.growth.landingUrl;
  return env.panelUrl ? `${env.panelUrl.replace(/\/$/, '')}${LANDING_PATH}` : LANDING_PATH;
}
