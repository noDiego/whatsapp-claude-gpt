import * as fs from 'fs';
import * as path from 'path';
import { Reminder, ReminderCreateInput } from '../interfaces/reminder';
import logger from '../logger';
import { v4 as uuidv4 } from 'uuid';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import Roboto from "../index";
import { AIRole } from "../interfaces/ai-interfaces";
import { ChatConfig } from "../config/chat-configurations";
import { addSeconds, extractAnswer } from "../utils";
import { addDays, addMonths, addWeeks } from 'date-fns';
import { CONFIG } from "../config";
import { format } from "date-fns-tz/dist/esm";

export class ReminderManager {
    private filePath: string;
    private reminders: Reminder[] = [];
    private wspClient;
    private chatConfig: ChatConfig;

    constructor(client, filePath: string = 'reminders.json') {
        this.filePath = filePath;
        this.wspClient = client;
        this.ensureFileExists();
        this.loadReminders();
        this.startReminderChecker();
        this.chatConfig = ChatConfig.getInstance();
    }

    private startReminderChecker() {
        setInterval(() => {
            this.checkReminders();
        }, 59 * 1000);
    }

    private async checkReminders() {
        const now = new Date();
        const dueReminders = this.reminders.filter(r => {
            const date = fromZonedTime(r.reminderDate, r.reminderDateTZ);
            return date <= now && r.isActive;
        });

        for (const reminder of dueReminders) {
            try {
                const chatCfg = this.chatConfig.getChatConfig(reminder.chatId, reminder.chatName);
                const msg = Roboto.convertIaMessagesLang([{
                    role: AIRole.USER,
                    name: 'SYSTEM',
                    content: [{
                        type: 'text',
                        value: `SYSTEM: The user has a reminder, write a message to remind them of the following: "${reminder.message}". Date: "${reminder.reminderDate}"`,
                        dateString: ''
                    }]
                }], CONFIG.getSystemPrompt(chatCfg));

                const aiResponse = await Roboto.openAIService.sendChat(msg, 'text', chatCfg);
                const reminderMsg = extractAnswer(aiResponse, chatCfg.botName);
                await this.wspClient.sendMessage(reminder.chatId, reminderMsg.message);

                if (reminder.recurrenceType && reminder.recurrenceType !== 'none') {
                    const nextDate = this.calculateNextRecurrence(reminder);
                    if (nextDate) {
                        const zonedDate = toZonedTime(nextDate, reminder.reminderDateTZ);
                        reminder.reminderDate = format(zonedDate, "yyyy-MM-dd'T'HH:mm:ss", { timeZone: reminder.reminderDateTZ });
                        reminder.updatedAt = new Date();
                        this.saveReminders();
                        logger.info(`Recurring reminder updated for next occurrence: ${reminder.id}`);
                    } else {
                        reminder.isActive = false;
                        this.saveReminders();
                        logger.info(`Recurring reminder completed and deactivated: ${reminder.id}`);
                    }
                } else {
                    this.deleteReminder(reminder.id);
                }

                logger.info(`Reminder sent to ${reminder.chatId} (${reminder.id})`);
            } catch (err) {
                logger.error(`Error sending reminder to ${reminder.chatId}: ${err.message}`);
            }
        }
    }

    /**
     * Calcula la próxima fecha de recurrencia
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

    /**
     * Ensures the JSON file exists
     */
    private ensureFileExists(): void {
        const dir = path.join(process.cwd(), this.filePath);
        if (!fs.existsSync(dir)) {
            fs.writeFileSync(dir, JSON.stringify([]), 'utf8');
        }
    }

    /**
     * Loads reminders from the JSON file
     */
    private loadReminders(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf8');
                const parsedData = JSON.parse(data);

                this.reminders = parsedData.map((reminder: any) => ({
                    ...reminder,
                    reminderDate: reminder.reminderDate,
                    createdAt: new Date(reminder.createdAt),
                    updatedAt: new Date(reminder.updatedAt),
                    recurrenceType: reminder.recurrenceType || 'none',
                    recurrenceInterval: reminder.recurrenceInterval || 1,
                    recurrenceEndDate: reminder.recurrenceEndDate || null,
                    recurrenceEndDateTZ: reminder.recurrenceEndDateTZ || null
                }));

                logger.info(`Loaded ${this.reminders.length} reminders from ${this.filePath}`);
            } else {
                this.reminders = [];
                this.saveReminders();
                logger.info(`Created new reminders file at ${this.filePath}`);
            }
        } catch (error: any) {
            logger.error(`Error loading reminders: ${error.message}`);
            this.reminders = [];
        }
    }

    /**
     * Saves reminders to the JSON file
     */
    private saveReminders(): void {
        try {
            const data = JSON.stringify(this.reminders, null, 2);
            fs.writeFileSync(this.filePath, data, 'utf8');
            logger.debug(`Saved ${this.reminders.length} reminders to ${this.filePath}`);
        } catch (error: any) {
            logger.error(`Error saving reminders: ${error.message}`);
            throw new Error(`Failed to save reminders: ${error.message}`);
        }
    }

    /**
     * Creates a new reminder
     */
    public createReminder(input: ReminderCreateInput): Reminder {
        try {
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
                recurrenceType: input.recurrenceType || 'none',
                recurrenceInterval: input.recurrenceInterval || 1,
                recurrenceEndDate: input.recurrenceEndDate || null,
                recurrenceEndDateTZ: input.recurrenceEndDateTZ || null
            };

            this.reminders.push(reminder);
            this.saveReminders();

            logger.info(`Created reminder with ID: ${reminder.id} for user: ${reminder.chatId}`);
            return reminder;
        } catch (error: any) {
            logger.error(`Error creating reminder: ${error.message}`);
            throw new Error(`Failed to create reminder: ${error.message}`);
        }
    }

    /**
     * Updates an existing reminder
     */
    public updateReminder(id: string, updates: Partial<ReminderCreateInput>): Reminder | null {
        try {
            const reminderIndex = this.reminders.findIndex(r => r.id === id);

            if (reminderIndex === -1) {
                logger.warn(`Reminder with ID ${id} not found`);
                return null;
            }

            const reminder = this.reminders[reminderIndex];

            if (updates.message !== undefined) reminder.message = updates.message;
            if (updates.reminderDate !== undefined) reminder.reminderDate = updates.reminderDate;
            if (updates.reminderDateTZ !== undefined) reminder.reminderDateTZ = updates.reminderDateTZ;
            if (updates.recurrenceType !== undefined) reminder.recurrenceType = updates.recurrenceType;
            if (updates.recurrenceInterval !== undefined) reminder.recurrenceInterval = updates.recurrenceInterval;
            if (updates.recurrenceEndDate !== undefined) reminder.recurrenceEndDate = updates.recurrenceEndDate;
            if (updates.recurrenceEndDateTZ !== undefined) reminder.recurrenceEndDateTZ = updates.recurrenceEndDateTZ;

            reminder.updatedAt = new Date();

            this.reminders[reminderIndex] = reminder;
            this.saveReminders();

            logger.info(`Updated reminder with ID: ${id}`);
            return reminder;
        } catch (error: any) {
            logger.error(`Error updating reminder: ${error.message}`);
            throw new Error(`Failed to update reminder: ${error.message}`);
        }
    }

    /**
     * Deletes a reminder
     */
    public deleteReminder(id: string): boolean {
        try {
            const initialLength = this.reminders.length;
            this.reminders = this.reminders.filter(r => r.id !== id);

            if (this.reminders.length === initialLength) {
                logger.warn(`Reminder with ID ${id} not found`);
                return false;
            }

            this.saveReminders();
            logger.info(`Deleted reminder with ID: ${id}`);
            return true;
        } catch (error: any) {
            logger.error(`Error deleting reminder: ${error.message}`);
            throw new Error(`Failed to delete reminder: ${error.message}`);
        }
    }

    /**
     * Gets all reminders for a specific user
     */
    public getRemindersByUser(userId: string): Reminder[] {
        return this.reminders.filter(r => r.chatId === userId);
    }

    /**
     * Deactivates a reminder without deleting it
     */
    public deactivateReminder(id: string): boolean {
        try {
            const reminder = this.reminders.find(r => r.id === id);
            if (!reminder) {
                logger.warn(`Reminder with ID ${id} not found`);
                return false;
            }

            reminder.isActive = false;
            reminder.updatedAt = new Date();
            this.saveReminders();

            logger.info(`Deactivated reminder with ID: ${id}`);
            return true;
        } catch (error: any) {
            logger.error(`Error deactivating reminder: ${error.message}`);
            throw new Error(`Failed to deactivate reminder: ${error.message}`);
        }
    }

    /**
     * Reactivates a reminder
     */
    public reactivateReminder(id: string): boolean {
        try {
            const reminder = this.reminders.find(r => r.id === id);
            if (!reminder) {
                logger.warn(`Reminder with ID ${id} not found`);
                return false;
            }

            reminder.isActive = true;
            reminder.updatedAt = new Date();
            this.saveReminders();

            logger.info(`Reactivated reminder with ID: ${id}`);
            return true;
        } catch (error: any) {
            logger.error(`Error reactivating reminder: ${error.message}`);
            throw new Error(`Failed to reactivate reminder: ${error.message}`);
        }
    }
}