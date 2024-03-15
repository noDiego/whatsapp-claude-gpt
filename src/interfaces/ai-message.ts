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
  type: 'text' | 'image';
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | string;
}

export enum AiLanguage {
  OPENAI='OPENAI',
  ANTHROPIC='ANTHROPIC'
}
