export interface AiMessage {
  role: AiRole;
  content: Array<AiContent>;
  name?: string;
}

export enum AiRole {
  USER='user',
  ASSISTANT='assistant',
}

export interface AiContent {
  value?: string;
  type: 'text' | 'image' | 'audio';
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | string;
}

export enum AiLanguage {
  OPENAI='OPENAI',
  CLAUDE='CLAUDE',
  QWEN='QWEN',
  DEEPSEEK='DEEPSEEK',
  CUSTOM='CUSTOM'
}

export interface AiAnswer {
  message: string;
  type: 'text' | 'audio';
  author: string;
  image_description? : string;
}
