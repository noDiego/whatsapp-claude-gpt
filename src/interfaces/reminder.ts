export interface Reminder {
    id: string;
    message: string;
    reminderDate: string;
    userId: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ReminderCreateInput {
    message: string;
    reminderDate: string;
    userId?: string;
}