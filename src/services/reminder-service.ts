import { Reminder, ReminderCreateInput } from '../interfaces/reminder';
import { reminders as remindersTable } from '../db/schema';
import logger from '../logger';
import { v4 as uuidv4 } from 'uuid';
import { format, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { AiMessage, AIRole, OperationResult } from "../interfaces/ai-interfaces";
import { chatConfigurationManager } from "../config/chat-configurations";
import { addSeconds, extractAnswer, getUserName } from "../utils";
import { addDays, addMonths, addWeeks } from 'date-fns';
import { CONFIG } from "../config";
import Roboto from "../bot/roboto";
import WspWeb from "../bot/wsp-web";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { Chat, Message } from "whatsapp-web.js";

class ReminderManager {

    constructor() {
        this.startReminderChecker();
    }

    private startReminderChecker() {
        setInterval(() => {
            this.checkReminders();
        }, 59 * 1000);
    }

    private async checkReminders() {
        const now = new Date();

        const dueReminders = await db.select()
            .from(remindersTable)
            .where(and(
                eq(remindersTable.isActive, true)
            ))
            .all();

        for (const r of dueReminders) {

            const reminder = this.mapRowToReminder(r);

            const scheduledDate = fromZonedTime(reminder.reminderDate, reminder.reminderDateTZ);
            if (scheduledDate > now) continue;

            try {
                const diffMs = now.getTime() - scheduledDate.getTime();
                if((diffMs / 60000) <= 60) {
                    await this.sendReminderMessage(reminder);
                } else {
                    logger.info(`Reminder for ${reminder.chatName} has expired. Reminder not sent`);
                }

                if (reminder.recurrenceType && reminder.recurrenceType !== 'none') {
                    const nextDate = this.calculateNextRecurrence(reminder);
                    if (nextDate) {
                        const zonedDate = toZonedTime(nextDate, reminder.reminderDateTZ);
                        await this.updateReminder(reminder.id, {
                            reminderDate: format(zonedDate, "yyyy-MM-dd'T'HH:mm:ss", { timeZone: reminder.reminderDateTZ }),
                            updatedAt: new Date(),
                        });
                        logger.info(`Recurring reminder updated for next occurrence: ${reminder.id}`);
                    } else {
                        await this.deactivateReminder(reminder.id);
                        logger.info(`Recurring reminder completed and deactivated: ${reminder.id}`);
                    }
                } else {
                    await this.deleteReminder(reminder.id);
                }

                logger.info(`Reminder for ${reminder.chatId} (${reminder.id}) processed.`);
            } catch (err) {
                logger.error(`Error processing reminder for ${reminder.chatId}: ${err.message}`);
            }
        }
    }


    private async sendReminderMessage(reminder: Reminder){

        const chatConfig = await chatConfigurationManager.getChatConfig(reminder.chatId, reminder.chatName);
        const systemPrompt = CONFIG.getSystemPrompt(chatConfig);

        const aiMessage: AiMessage = {
            role: AIRole.USER,
            name: 'SYSTEM',
            content: [{
                type: 'text',
                value: `SYSTEM: The user has a new reminder, write a message to remind them of the following: "${reminder.message}". RecipientName: ${reminder.chatName}. Date: "${reminder.reminderDate}"`,
                dateString: reminder.reminderDate,
                author_id: 'SYSTEM'
            }]
        };
        const aiResponse = await Roboto.sendMessageToAi([aiMessage], systemPrompt, reminder.chatId);
        const reminderMsg = extractAnswer(aiResponse, chatConfig.botName);
        if (!reminderMsg || !reminderMsg.message) return false;
        return WspWeb.getWspClient().sendMessage(reminder.chatId, reminderMsg.message);
    }

    /**
     * Calculates the next recurrence date for a reminder
     */
    private calculateNextRecurrence(reminder: Reminder): Date | null {
        const currentDate = fromZonedTime(reminder.reminderDate, reminder.reminderDateTZ);
        const interval = reminder.recurrenceInterval || 1;
        let nextDate: Date;

        switch (reminder.recurrenceType) {
            case 'minutes':
                nextDate = addSeconds(currentDate, interval*60);
                break;
            case 'daily':
                nextDate = addDays(currentDate, interval);
                break;
            case 'weekly':
                nextDate = addWeeks(currentDate, interval);
                break;
            case 'monthly':
                nextDate = addMonths(currentDate, interval);
                break;
            default:
                return null;
        }

        if (reminder.recurrenceEndDate && reminder.recurrenceEndDateTZ) {
            const endDate = fromZonedTime(reminder.recurrenceEndDate, reminder.recurrenceEndDateTZ);
            if (nextDate > endDate) {
                return null;
            }
        }

        return nextDate;
    }

    public async processFunctionCall(args): Promise<OperationResult>{
        const {
            action,
            message: reminderMessage,
            reminder_date,
            reminder_date_timezone,
            reminder_id,
            recurrence_type,
            recurrence_interval,
            recurrence_end_date,
            recurrence_end_date_timezone,
            msg_id
        } = args;


        const wspMsg: Message = await WspWeb.getWspClient().getMessageById(msg_id)
        const chatData: Chat = await wspMsg.getChat();
        const chatId = chatData.id._serialized;
        const chatName = chatData.name ?? await getUserName(wspMsg);
        let responseMessage = '';
        let reminder;

        switch (action) {
            case 'list':
                const remindersList = await this.getRemindersByUser(chatId);
                responseMessage = JSON.stringify(remindersList);
                break;

            case 'create':
                reminder = this.createReminder({
                    message: reminderMessage,
                    reminderDate: reminder_date,
                    reminderDateTZ: reminder_date_timezone || CONFIG.BotConfig.botTimezone,
                    chatId: chatId,
                    chatName: chatName,
                    recurrenceType: recurrence_type || 'none',
                    recurrenceInterval: recurrence_interval || 1,
                    recurrenceEndDate: recurrence_end_date || null,
                    recurrenceEndDateTZ: recurrence_end_date_timezone || CONFIG.BotConfig.botTimezone
                });
                responseMessage = `Reminder created successfully. (Data: ${JSON.stringify(reminder)})`;
                break;

            case 'update':
                reminder = this.updateReminder(reminder_id, {
                    message: reminderMessage,
                    reminderDate: reminder_date,
                    reminderDateTZ: reminder_date_timezone || CONFIG.BotConfig.botTimezone,
                    recurrenceType: recurrence_type,
                    recurrenceInterval: recurrence_interval,
                    recurrenceEndDate: recurrence_end_date,
                    recurrenceEndDateTZ: recurrence_end_date_timezone || CONFIG.BotConfig.botTimezone
                });
                responseMessage = `Reminder updated successfully. (Data: ${JSON.stringify(reminder)})`;
                break;

            case 'delete':
                this.deleteReminder(reminder_id);
                responseMessage = `Reminder deleted successfully`;
                break;

            case 'deactivate':
                this.deactivateReminder(reminder_id);
                responseMessage = `Reminder deactivated successfully`;
                break;

            case 'reactivate':
                this.reactivateReminder(reminder_id);
                responseMessage = `Reminder reactivated successfully`;
                break;
        }

        return {success: true, result: responseMessage};
    }

    /**
     * Creates a new reminder
     */
    private async createReminder(input: ReminderCreateInput): Promise<Reminder> {
        const now = new Date();
        const reminder: Reminder = {
            id: uuidv4(),
            message: input.message,
            reminderDate: input.reminderDate,
            reminderDateTZ: input.reminderDateTZ,
            chatId: input.chatId,
            chatName: input.chatName,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            recurrenceType: input.recurrenceType ?? 'none',
            recurrenceInterval: input.recurrenceInterval ?? 1,
            recurrenceEndDate: input.recurrenceEndDate ?? null,
            recurrenceEndDateTZ: input.recurrenceEndDateTZ ?? null,
        };

        await db.insert(remindersTable).values({
            ...reminder,
            createdAt: reminder.createdAt.toISOString(),
            updatedAt: reminder.updatedAt.toISOString(),
        }).run();

        logger.info(`Created reminder with ID: ${reminder.id} for user: ${reminder.chatId}`);
        return reminder;
    }

    /**
     * Updates an existing reminder
     */
    private async updateReminder(id: string, updates: Partial<ReminderCreateInput>): Promise<Reminder | null> {
        const updatedAt = new Date().toISOString();

        const result = await db.update(remindersTable)
            .set({ ...updates , updatedAt })
            .where(eq(remindersTable.id, id))
            .returning();

        if (result.length === 0) {
            logger.warn(`Reminder with ID ${id} not found`);
            return null;
        }
        logger.info(`Updated reminder with ID: ${id}`);
        return this.mapRowToReminder(result[0]);
    }

    /**
     * Deletes a reminder
     */
    private async deleteReminder(id: string): Promise<boolean> {
        const result = await db.delete(remindersTable).where(eq(remindersTable.id, id)).run();
        if (result.changes === 0) {
            logger.warn(`Reminder with ID ${id} not found`);
            return false;
        }
        logger.info(`Deleted reminder with ID: ${id}`);
        return true;
    }

    /**
     * Gets all reminders for a specific user
     */
    private async getRemindersByUser(userId: string): Promise<Reminder[]> {
        const rows = await db.select().from(remindersTable).where(eq(remindersTable.chatId, userId)).all();
        return rows.map(this.mapRowToReminder);
    }

    /**
     * Deactivates a reminder without deleting it
     */
    private async deactivateReminder(id: string): Promise<boolean> {
        const updatedAt = new Date().toISOString();
        const result = await db.update(remindersTable)
            .set({ isActive: false, updatedAt })
            .where(eq(remindersTable.id, id))
            .run();
        if (result.changes === 0) {
            logger.warn(`Reminder with ID ${id} not found`);
            return false;
        }
        logger.info(`Deactivated reminder with ID: ${id}`);
        return true;
    }

    /**
     * Reactivates a reminder
     */
    private async reactivateReminder(id: string): Promise<boolean> {
        const updatedAt = new Date().toISOString();
        const result = await db.update(remindersTable)
            .set({ isActive: true, updatedAt })
            .where(eq(remindersTable.id, id))
            .run();
        if (result.changes === 0) {
            logger.warn(`Reminder with ID ${id} not found`);
            return false;
        }
        logger.info(`Reactivated reminder with ID: ${id}`);
        return true;
    }

    private mapRowToReminder(row: any): Reminder {
        return {
            ...row,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
        };
    }
}

const Reminders = new ReminderManager();
export default Reminders;