export interface AiMessage {
  role: AIRole;
  content: Array<AIContent>;
  name?: string;
}

export enum AIRole {
  USER='user',
  ASSISTANT='assistant',
  SYSTEM='system',
}

export interface AIContent {
  imageId?: string;
  value?: string;
  type: 'text' | 'image' | 'audio';
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | string;
}

export enum AIProvider {
  OPENAI='OPENAI',
  ELEVENLABS='ELEVENLABS'
}

export interface AIAnswer {
  message: string;
  type: 'text' | 'audio';
  author: string;
  emojiReact?: string;
}
