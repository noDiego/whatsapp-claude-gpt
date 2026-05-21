import { promises as fs } from 'fs';
import path from 'path';
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from 'baileys';

type PersistedAuthState = {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, any>>;
};

function emptyState(): PersistedAuthState {
  return {
    creds: initAuthCreds(),
    keys: {},
  };
}

export class BaileysAuthStore {
  private state: PersistedAuthState = emptyState();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly authDir: string) {}

  private get filePath() {
    return path.join(this.authDir, 'auth-state.json');
  }

  async load(): Promise<AuthenticationState> {
    await fs.mkdir(this.authDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.state = JSON.parse(raw, BufferJSON.reviver);
    } catch {
      this.state = emptyState();
      await this.flush();
    }

    return {
      creds: this.state.creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const bucket = this.state.keys[type] || {};
          const result: Record<string, SignalDataTypeMap[T]> = {};

          for (const id of ids) {
            let value = bucket[id];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }

            if (value) {
              result[id] = value;
            }
          }

          return result;
        },
        set: async (data: SignalDataSet) => {
          for (const category of Object.keys(data)) {
            const categoryData = data[category];
            if (!categoryData) continue;

            this.state.keys[category] ||= {};

            for (const id of Object.keys(categoryData)) {
              const value = categoryData[id];
              if (value) {
                this.state.keys[category][id] = value;
              } else {
                delete this.state.keys[category][id];
              }
            }
          }

          this.scheduleSave();
        },
      },
    };
  }

  updateCreds(update: Partial<AuthenticationCreds>) {
    this.state.creds = {
      ...this.state.creds,
      ...update,
    };
    this.scheduleSave();
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await fs.writeFile(this.filePath, JSON.stringify(this.state, BufferJSON.replacer, 2));
  }

  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.flush().catch(() => undefined);
    }, 250);
  }
}
