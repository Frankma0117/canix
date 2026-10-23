/** Navigates to a portal section (the hash router in App.tsx picks it up). */
export function goTo(id: string) {
  window.location.hash = `/${id}`;
}
