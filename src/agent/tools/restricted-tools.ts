/**
 * Tools that only make sense for the primary admin and are never assignable to a restricted
 * user's allowed_tools list - they're already gated by ctx.isAdmin inside each one's execute(),
 * this just keeps them out of list_available_tools/set_user_permissions so the admin isn't offered
 * a nonsensical grant (e.g. letting someone restrict their own access).
 */
export const ADMIN_ONLY_TOOLS = [
  'grant_access',
  'revoke_access',
  'list_users',
  'set_user_permissions',
  'list_available_tools',
  'list_stickers',
  'delete_sticker',
  'announce_update',
];
