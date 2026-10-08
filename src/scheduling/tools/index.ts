import type { registry as Registry } from '../../agent/tool-registry.js';
import { professionalTools } from './professional.tools.js';
import { clientTools } from './client.tools.js';
import { manageSchedulingGroupTool } from './admin.tools.js';

/** Registers every scheduling tool (access is decided per user by permissions/catalog.ts). */
export function registerSchedulingTools(registry: typeof Registry): void {
  for (const t of [...professionalTools, ...clientTools, manageSchedulingGroupTool]) registry.register(t);
}
