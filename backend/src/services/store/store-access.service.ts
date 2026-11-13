import { permissionsModel } from '../../models/permissions.model.js';
import { storesModel } from '../../models/store.model.js';
import { usersModel } from '../../models/users.model.js';
import { issueTemporaryPassword } from '../auth/web-auth.service.js';
import { phoneToJid } from '../../shared/utils/jid.js';
import { StoreError } from './store-orders.service.js';
import type { Store, User } from '../../entities/index.js';

/**
 * Who manages which business.
 *   - The administrator (the developer) sees and manages every store, creates and deletes them,
 *     and decides who its people are.
 *   - A business administrator is an ordinary portal user with the `store.manage` permission who
 *     is a member of one or more stores: they see ONLY the order-assistant sections, and only
 *     their own stores' data.
 */
export function storesVisibleTo(user: Pick<User, 'id' | 'role'>): Store[] {
  return user.role === 'admin' ? storesModel.list() : storesModel.listForUser(user.id);
}

export function canManageStore(user: Pick<User, 'id' | 'role'>, storeId: number): boolean {
  return user.role === 'admin' || storesModel.isMember(storeId, user.id);
}

export interface AddedMember {
  user: User;
  /** Set when the person had no portal password: shown once to the administrator. */
  temporaryPassword: string | null;
  created: boolean;
}

/**
 * Makes someone a business administrator of a store, by WhatsApp number. Creates their Canix
 * account if they had none, with just what this role needs: the order assistant and the portal.
 */
export async function addStoreMember(storeId: number, input: { phone: string; name?: string | null }, actorId: number): Promise<AddedMember> {
  const digits = input.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new StoreError('Escribe el número de WhatsApp con indicativo, por ejemplo 573001234567.');
  const jid = phoneToJid(digits);
  const existing = usersModel.getByJidOrLid(jid);
  const user = existing ?? usersModel.create({ jid, name: input.name?.trim() || null });
  if (!existing) usersModel.ensurePanelToken(user.id);

  if (user.role !== 'admin') {
    permissionsModel.setOverride(actorId, user.id, 'store.manage', 'allow');
    permissionsModel.setOverride(actorId, user.id, 'portal.access', 'allow');
  }
  storesModel.addMember(storeId, user.id);
  const temporaryPassword = user.password_hash ? null : await issueTemporaryPassword(user.id, actorId);
  return { user: usersModel.getById(user.id)!, temporaryPassword, created: !existing };
}

/** Takes a store away from someone; with no stores left, the `store.manage` permission goes too. */
export function removeStoreMember(storeId: number, userId: number, actorId: number): void {
  storesModel.removeMember(storeId, userId);
  const user = usersModel.getById(userId);
  if (user && user.role !== 'admin' && storesModel.membershipCount(userId) === 0) {
    permissionsModel.setOverride(actorId, userId, 'store.manage', null);
  }
}
