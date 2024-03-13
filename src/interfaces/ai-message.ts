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
}

export enum AiLanguage {
  OPENAI='OPENAI',
  ANTHROPIC='ANTHROPIC'
}
