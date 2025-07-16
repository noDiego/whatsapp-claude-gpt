export interface Reminder {
    id: string;
    message: string;
    reminderDate: string;
    reminderDateTZ: string;
    chatId: string;
    chatName: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    recurrenceType?: 'none' | 'minutes' | 'daily' | 'weekly' | 'monthly';
    recurrenceInterval?: number;
    recurrenceEndDate?: string;
    recurrenceEndDateTZ?: string;
}
export interface ReminderCreateInput {
    message: string;
    reminderDate: string;
    reminderDateTZ: string;
    chatName?: string;
    chatId?: string;
    recurrenceType?: 'none' | 'minutes' | 'daily' | 'weekly' | 'monthly';
    recurrenceInterval?: number;
    recurrenceEndDate?: string;
    recurrenceEndDateTZ?: string;
}