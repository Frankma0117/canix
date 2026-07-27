import { registry } from '../tool-registry.js';
import { createCategoryTool } from './create-category.tool.js';
import { listCategoriesTool } from './list-categories.tool.js';
import { saveLinkTool } from './save-link.tool.js';
import { listLinksTool } from './list-links.tool.js';
import { pickLinkTool } from './pick-link.tool.js';
import { deleteLinkTool } from './delete-link.tool.js';
import { scheduleReminderTool } from './schedule-reminder.tool.js';
import { listRemindersTool } from './list-reminders.tool.js';
import { cancelReminderTool } from './cancel-reminder.tool.js';
import { addContactTool } from './add-contact.tool.js';
import { listContactsTool } from './list-contacts.tool.js';
import { sendMessageTool } from './send-message.tool.js';
import { addTodoTool } from './add-todo.tool.js';
import { listTodosTool } from './list-todos.tool.js';
import { completeTodoTool } from './complete-todo.tool.js';
import { deleteTodoTool } from './delete-todo.tool.js';
import { createRoutineTool } from './create-routine.tool.js';
import { checkinRoutineTool } from './checkin-routine.tool.js';
import { routineProgressTool } from './routine-progress.tool.js';

/** Registers every tool the agent can use. Called once at boot. */
export function registerTools(): void {
  registry.register(createCategoryTool);
  registry.register(listCategoriesTool);
  registry.register(saveLinkTool);
  registry.register(listLinksTool);
  registry.register(pickLinkTool);
  registry.register(deleteLinkTool);
  registry.register(scheduleReminderTool);
  registry.register(listRemindersTool);
  registry.register(cancelReminderTool);
  registry.register(addContactTool);
  registry.register(listContactsTool);
  registry.register(sendMessageTool);
  registry.register(addTodoTool);
  registry.register(listTodosTool);
  registry.register(completeTodoTool);
  registry.register(deleteTodoTool);
  registry.register(createRoutineTool);
  registry.register(checkinRoutineTool);
  registry.register(routineProgressTool);
}
