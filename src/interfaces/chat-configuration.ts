export interface ChatConfiguration {
    id: string;
    name: string;
    promptInfo: string;
    botName?: string;
    maxImages?: number;
    maxMsgsLimit?: number;
    maxHoursLimit?: number;
    chatModel?: string;
    imageModel?: string;
    ttsProvider?: string;
    ttsModel?: string;
    ttsVoice?: string;
    sttModel?: string;
    sttLanguage?: string;
    imageCreationEnabled?: string;
    voiceCreationEnabled?: string;
}