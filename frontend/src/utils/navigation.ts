/** Navigates to a portal section (the hash router in App.tsx picks it up). */
export function goTo(id: string) {
  window.location.hash = `/${id}`;
}

/** A parameter after "?" in the hash (#/store-bot?tab=whatsapp) - each page reads its own. */
export function hashParam(name: string): string | null {
  const query = window.location.hash.split('?')[1];
  return query ? new URLSearchParams(query).get(name) : null;
}
