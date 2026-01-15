import logger from './logger';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import Roboto from "./bot/roboto";
import WhatsappHandler from "./bot/wsp-web";
import { configValidation, logConfigInfo } from "./utils";

require('dotenv').config();
configValidation()
logConfigInfo();

async function start() {
  try {

    const wspClient = new Client({
      authStrategy: new LocalAuth({dataPath: 'session'}),
      puppeteer: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
      },
      webVersionCache: {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/2.3000.1031490220-alpha.html`,
      },
      takeoverTimeoutMs: 40000,
      qrMaxRetries:5,
      restartOnAuthFail: true
    });

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

    wspClient.on("ready", async () => {
      // Patch sendSeen to use markSeen instead (fixes markedUnread error)
      await wspClient.pupPage?.evaluate(`
    window.WWebJS.sendSeen = async (chatId) => {
      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      if (chat) {
        window.Store.WAWebStreamModel.Stream.markAvailable();
        await window.Store.SendSeen.markSeen(chat);
        window.Store.WAWebStreamModel.Stream.markUnavailable();
        return true;
      }
      return false;
    };
  `);
      return logger.info('Client is ready!');

    });

    wspClient.on('message', async (message: Message) => Roboto.readWspMessage(message));

    await wspClient.initialize();

    WhatsappHandler.setWspClient(wspClient);
  } catch (e: any) {
    logger.error(`ERROR: ${e.message}`);
  }
}

start();