export interface AiMessage {
  role: AIRole;
  content: Array<AIContent>;
  name?: string;
}

export enum AIRole {
  USER='user',
  ASSISTANT='assistant',
  SYSTEM='system'
}

export interface AIContent {
  msg_id?: string;
  value?: string;
  type: 'text' | 'image' | 'ASR' | 'file';
  mimetype?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | string;
  filename?: string,
  author_id: string,
  dateString: string;
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
  emojiReact?: string;
}

export interface OperationResult {
  success: boolean;
  result: any;
}