import logger from './logger';
import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from 'qrcode-terminal';
import Roboto from "./bot/roboto";
import WhatsappHandler from "./bot/wsp-web";
import Reminders from "./services/reminder-service";
import ConnectionManager from "./services/connection-service";
import { configValidation, logConfigInfo } from "./utils";
import { CONFIG } from "./config";

require('dotenv').config();
configValidation()
logConfigInfo();

async function start() {
  try {

    const puppeteerArgs: string[] = [
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu'
    ];

    // Chromium only accepts --no-zygote when sandbox is also disabled, so keep
    // those flags coupled for Docker/root environments that require them.
    if (CONFIG.BotConfig.puppeteerNoSandbox) {
      puppeteerArgs.unshift('--no-sandbox', '--disable-setuid-sandbox', '--no-zygote');
    }

    const wspClient = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        args: puppeteerArgs,
      }
    });

    // Set the WhatsApp client immediately after construction so all downstream
    // consumers can access it as soon as it becomes available.
    WhatsappHandler.setWspClient(wspClient);

    logger.info('Starting WhatsApp client...');

    wspClient.on('qr', qr => {
      logger.info('QR Code received, scan please');
      qrcode.generate(qr, { small: true });
    });

    wspClient.on('authenticated', () => {
      logger.info('Client authenticated');
    });

    wspClient.on('auth_failure', async (msg) => {
      logger.error(`Authentication failure: ${msg}`);
    });

    wspClient.on('ready', () => {
      logger.info('Client is ready!');
      // Start the reminder checker now that the WhatsApp client is available.
      Reminders.startReminderChecker();
      // Clear any fatal error tracking from a previous connection cycle.
      Reminders.clearFatalErrors();
      // Start the connection watchdog to detect and recover from Puppeteer crashes.
      ConnectionManager.startWatchdog();
    });

    // Log disconnection events for visibility. Recovery is handled by the
    // connection watchdog, not here, to avoid duplicate logic.
    wspClient.on('disconnected', (reason: string) => {
      logger.warn(`[index] WhatsApp client disconnected. Reason: ${reason}`);
    });

    // Capture unhandled rejections from the message listener so a single
    // failing message does not crash the process.
    wspClient.on('message', (message: Message) => {
      void Roboto.readWspMessage(message).catch((e) => {
        logger.error(`[index] Unhandled error in readWspMessage: ${e.message}`);
      });
    });

    await wspClient.initialize();

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        ConnectionManager.stopWatchdog();
        Reminders.stopReminderChecker();
        await wspClient.destroy();
        logger.info('WhatsApp client destroyed');
      } catch (e: any) {
        logger.error(`Error destroying WhatsApp client: ${e.message}`);
      }
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (e: any) {
    logger.error(`ERROR: ${e.message}`);
  }
}

// Global handlers for unhandled rejections and uncaught exceptions.
// These prevent silent process crashes and log the error for debugging.
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error(`[process] Unhandled Rejection at: ${promise}, reason: ${reason?.message || reason}`);
});

process.on('uncaughtException', (error: Error) => {
  logger.error(`[process] Uncaught Exception: ${error.message}`);
  // For uncaught exceptions we perform a controlled shutdown
  // because the process may be in an inconsistent state.
  try {
    ConnectionManager.stopWatchdog();
    Reminders.stopReminderChecker();
  } catch (_) { /* ignore errors during emergency cleanup */ }
  process.exit(1);
});

start();
