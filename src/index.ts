import logger from './logger';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import Roboto from "./bot/roboto";
import { fetchCurrentAlphaVersion } from "@wppconnect/wa-version";
import WhatsappHandler from "./bot/wsp-web";
import { configValidation, logConfigInfo } from "./utils";
import path from 'path';
import * as fs from "node:fs";

require('dotenv').config();
configValidation();
logConfigInfo();

const SESSION_DIR = path.join(process.cwd(), 'sessions');
const READY_TIMEOUT_MS = 2 * 60000; //2 minutes

let retryCount = 0;
const MAX_RETRIES = 3;

async function removeSessionDir() {
  logger.warn('Removing session directory to restart login...');
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true })
    logger.warn('Session directory deleted.');
  } catch (e) {
    logger.error('Error deleting sessions directory: ' + (e as Error).message);
  }
}

async function start() {
  try {
    const latestVersion = await fetchCurrentAlphaVersion();

    let readyTriggered = false;
    let readyTimeout: NodeJS.Timeout;

    const wspClient = new Client({
      authStrategy: new LocalAuth({ dataPath: "sessions" }),
      webVersionCache: {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/${latestVersion}.html`,
      }
    });

    readyTimeout = setTimeout(async () => {
      if (!readyTriggered) {
        logger.error(`The 'ready' event was not received after ${READY_TIMEOUT_MS / 1000} seconds.`);
        wspClient.destroy();
        await removeSessionDir();

        retryCount++;
        if (retryCount > MAX_RETRIES) {
          logger.error('Maximum number of retries reached. Aborting.')
          process.exit(1);
        }

        logger.info('Retrying...');
        setTimeout(start, 3000);
      }
    }, READY_TIMEOUT_MS);

    wspClient.on('qr', qr => qrcode.generate(qr, { small: true }));

    wspClient.on('ready', () => {
      readyTriggered = true;
      clearTimeout(readyTimeout);
      logger.info('Client is ready!');
    });

    wspClient.on('message', async (message: Message) => Roboto.readWspMessage(message));

    wspClient.on('auth_failure', async (msg) => {
      logger.error('[WA] Authentication error: ' + msg)
      await removeSessionDir();
      retryCount++;
      setTimeout(start, 3000);
    });

    wspClient.on('disconnected', async (reason) => {
      logger.warn(`[WA] Disconnected: ${reason}`);
      await removeSessionDir();
      retryCount++;
      setTimeout(start, 3000);
    });

    await wspClient.initialize();

    WhatsappHandler.setWspClient(wspClient);

  } catch (e: any) {
    logger.error(`ERROR: ${e.message}`);
    logger.error('Retrying startup after 5 seconds...');
    setTimeout(start, 5000);
  }
}

start();