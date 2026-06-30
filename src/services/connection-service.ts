import logger from '../logger';
import { WAState } from 'whatsapp-web.js';
import WspWeb from '../bot/wsp-web';
import { CONFIG } from '../config';

class ConnectionManager {
    private watchdogInterval: NodeJS.Timeout | null = null;
    private isProbing = false;
    private isReconnecting = false;
    private consecutiveFailures = 0;

    constructor() {}

    public startWatchdog(): void {
        if (!CONFIG.BotConfig.watchdogEnabled) {
            logger.info('[ConnectionManager] Watchdog disabled by config (WATCHDOG_ENABLED=false).');
            return;
        }
        if (this.watchdogInterval) {
            logger.warn('[ConnectionManager] Watchdog already running, skipping duplicate start.');
            return;
        }
        logger.info(
            `[ConnectionManager] Starting connection watchdog (interval: ${CONFIG.BotConfig.watchdogIntervalSec}s).`
        );
        this.watchdogInterval = setInterval(() => {
            this.probeConnection().catch((e: Error) => {
                logger.error(`[ConnectionManager] Unhandled error in probeConnection: ${e.message}`);
            });
        }, CONFIG.BotConfig.watchdogIntervalSec * 1000);
    }

    public stopWatchdog(): void {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
            logger.info('[ConnectionManager] Watchdog stopped.');
        }
    }

    private async probeConnection(): Promise<void> {
        if (this.isProbing || this.isReconnecting) {
            return;
        }
        this.isProbing = true;
        try {
            const client = WspWeb.getWspClient();
            let state: string;
            try {
                state = await client.getState();
            } catch (e: any) {
                logger.warn(`[WATCHDOG] Fatal Puppeteer error probing connection: ${e.message}`);
                this.isProbing = false;
                await this.reconnect();
                return;
            }

            if (state !== WAState.CONNECTED) {
                logger.info(
                    `[WATCHDOG] Connection state: ${state} (not CONNECTED). Waiting for recovery or QR scan.`
                );
            }
        } catch (e: any) {
            logger.error(`[ConnectionManager] Error in probeConnection: ${e.message}`);
        } finally {
            this.isProbing = false;
        }
    }

    private async reconnect(): Promise<void> {
        if (this.isReconnecting) {
            return;
        }
        this.isReconnecting = true;
        try {
            this.consecutiveFailures++;

            if (
                CONFIG.BotConfig.reconnectMaxAttempts > 0 &&
                this.consecutiveFailures > CONFIG.BotConfig.reconnectMaxAttempts
            ) {
                logger.error(
                    `[ConnectionManager] Max reconnect attempts (${CONFIG.BotConfig.reconnectMaxAttempts}) exceeded. Exiting.`
                );
                await this.failAndExit();
                return;
            }

            const base = CONFIG.BotConfig.reconnectBaseDelaySec;
            const max = CONFIG.BotConfig.reconnectMaxDelaySec;
            const exponential = base * Math.pow(2, this.consecutiveFailures - 1);
            const delay = Math.min(exponential, max);
            const jitter = Math.floor(Math.random() * delay * 0.5);
            const totalDelay = delay + jitter;

            logger.warn(
                `[ConnectionManager] Attempting reconnect #${this.consecutiveFailures} after ${totalDelay}s delay...`
            );
            await this.sleep(totalDelay * 1000);

            const client = WspWeb.getWspClient();

            try {
                await client.destroy();
                logger.info('[ConnectionManager] Client destroyed.');
            } catch (e: any) {
                logger.warn(`[ConnectionManager] Non-critical error destroying client: ${e.message}`);
            }

            await client.initialize();
            logger.info('[ConnectionManager] Client re-initialized successfully.');

            this.consecutiveFailures = 0;
        } catch (e: any) {
            logger.error(
                `[ConnectionManager] Reconnect attempt ${this.consecutiveFailures} failed: ${e.message}`
            );
        } finally {
            this.isReconnecting = false;
        }
    }

    private async failAndExit(): Promise<void> {
        logger.error('[ConnectionManager] Performing ordered shutdown before exit...');
        try {
            const client = WspWeb.getWspClient();
            await client.destroy();
        } catch (e: any) {
            logger.error(`[ConnectionManager] Error destroying client during failAndExit: ${e.message}`);
        }
        process.exit(1);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

const ConnectionManagerInstance = new ConnectionManager();
export default ConnectionManagerInstance;
