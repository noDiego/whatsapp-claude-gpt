import * as fs from 'fs';
import * as path from 'path';
import { Reminder, ReminderCreateInput } from '../interfaces/reminder';
import logger from '../logger';
import { v4 as uuidv4 } from 'uuid';

export class ReminderManager {
    private filePath: string;
    private reminders: Reminder[] = [];
    private wspClient;

    constructor(client, filePath: string = 'reminders.json') {
        this.filePath = filePath;
        this.wspClient = client;
        this.ensureFileExists();
        this.loadReminders();
        this.startReminderChecker();
    }

    private startReminderChecker() {
        setInterval(() => {
            this.checkReminders();
        }, 60 * 1000); // cada minuto
    }

    private async checkReminders() {
        const now = new Date();
        // Recuerda usar UTC o la misma TZ que usan tus horarios
        // Solo recordatorios activos y cuya fecha <= ahora
        const dueReminders = this.reminders.filter(r =>
            r.isActive && (!r.reminderDate || new Date(r.reminderDate) <= now)
        );
        for (const reminder of dueReminders) {
            try {
                // Intenta enviar mensaje
                await this.wspClient.sendMessage(reminder.userId, `🔔 Recordatorio:\n"${reminder.message}"\n(${reminder.reminderDate})`);
                // Elimina el recordatorio
                this.deleteReminder(reminder.id);
                logger.info(`Reminder sent to ${reminder.userId} and deleted (${reminder.id})`);
            } catch (err) {
                logger.error(`Error sending reminder to ${reminder.userId}: ${err.message}`);
            }
        }
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

                // Convert date strings back to Date objects
                this.reminders = parsedData.map((reminder: any) => ({
                    ...reminder,
                    reminderDate: reminder.reminderDate,
                    createdAt: new Date(reminder.createdAt),
                    updatedAt: new Date(reminder.updatedAt)
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
                userId: input.userId,
                isActive: true,
                createdAt: now,
                updatedAt: now
            };

            this.reminders.push(reminder);
            this.saveReminders();

            logger.info(`Created reminder with ID: ${reminder.id} for user: ${reminder.userId}`);
            return reminder;
        } catch (error: any) {
            logger.error(`Error creating reminder: ${error.message}`);
            throw new Error(`Failed to create reminder: ${error.message}`);
        }
    }

    /**
     * Updates an existing reminder
     */
    public updateReminder(id: string, updates: ReminderCreateInput): Reminder | null {
        try {
            const reminderIndex = this.reminders.findIndex(r => r.id === id);

            if (reminderIndex === -1) {
                logger.warn(`Reminder with ID ${id} not found`);
                return null;
            }

            const reminder = this.reminders[reminderIndex];

            // Update fields if provided
            if (updates.message !== undefined) reminder.message = updates.message;
            if (updates.reminderDate !== undefined) reminder.reminderDate = updates.reminderDate;

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
        return this.reminders.filter(r => r.userId === userId);
    }

}