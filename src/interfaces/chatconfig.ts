export interface ChatCfg {
  prompt_name: string;
  prompt_text: string;
  gif_url: string;
  limit: number;
  prefix: string;
  groups: string;
  premsg: string;
  hourslimit: number;
  characterslimit: number;
  buildprompt: boolean;
  maxtokens: number;
  maximages: number;
  voice_id: string;
  ia_model: string;
}

export enum GPTRol{
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}
