import type OpenAI from 'openai';
import type { WaManager } from '../whatsapp/wa-manager.js';

/** Context passed to tools when they execute. */
export interface ToolContext {
  /** JID of the current conversation (used as the default reminder/message target). */
  ownerJid: string;
  /** Internal id of the user sending this message - every per-user table is scoped to this. */
  userId: number;
  /** True if this user is the admin (can grant/revoke access - see user-management tools). */
  isAdmin: boolean;
  /** WhatsApp access so a tool can send messages. */
  wa: WaManager;
}

/**
 * Definition of a tool the agent can invoke.
 * To add a new tool: create a file in src/agent/tools/,
 * export it and register it in src/agent/tools/index.ts.
 */
export interface Tool {
  /** Unique name (the LLM uses it to call the tool). */
  name: string;
  /** Clear description of what it does and when to use it. */
  description: string;
  /** JSON Schema of the parameters. */
  parameters: Record<string, unknown>;
  /** Tool logic. Returns a string sent back to the LLM. */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  toOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [...this.tools.values()].map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}

export const registry = new ToolRegistry();
