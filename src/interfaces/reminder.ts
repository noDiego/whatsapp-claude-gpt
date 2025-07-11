export interface Reminder {
    id: string;
    message: string;
    reminderDate: string;
    reminderDateTZ: string;
    chatId: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ReminderCreateInput {
    message: string;
    reminderDate: string;
    reminderDateTZ: string;
    chatId?: string;
}