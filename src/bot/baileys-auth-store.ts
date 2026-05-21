import { promises as fs } from 'fs';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import type { AuthenticationState } from '@whiskeysockets/baileys';

export class BaileysAuthStore {
  private state: AuthenticationState | null = null;
  private saveCreds: (() => Promise<void>) | null = null;

  constructor(private readonly authDir: string) {}

  async load(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    await fs.mkdir(this.authDir, { recursive: true });

    const result = await useMultiFileAuthState(this.authDir);
    this.state = result.state;
    this.saveCreds = result.saveCreds;

    return result;
  }

  isRegistered(): boolean {
    return !!this.state?.creds?.registered;
  }

  async reset(): Promise<void> {
    this.state = null;
    this.saveCreds = null;
    await fs.rm(this.authDir, { recursive: true, force: true });
  }

  async flush(): Promise<void> {
    if (this.saveCreds) {
      await this.saveCreds();
    }
  }
}
