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
  value?: string;
  type: 'text' | 'image' | 'audio';
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | string;
}

export enum AIProvider {
  OPENAI='OPENAI',
  CLAUDE='CLAUDE',
  QWEN='QWEN',
  DEEPSEEK='DEEPSEEK',
  DEEPINFRA='DEEPINFRA',
  ELEVENLABS='ELEVENLABS',
  CUSTOM='CUSTOM'
}

export interface AIAnswer {
  message: string;
  type: 'text' | 'audio';
  author: string;
}
