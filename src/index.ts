import logger from './logger';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import Roboto from "./bot/roboto";
import { fetchCurrentAlphaVersion } from "@wppconnect/wa-version";
import WhatsappHandler from "./bot/wsp-web";
import { configValidation, logConfigInfo } from "./utils";

require('dotenv').config();
configValidation()
logConfigInfo();

async function start() {
  try {
    const latestVersion = await fetchCurrentAlphaVersion();

    const wspClient = new Client({
      authStrategy: new LocalAuth({ dataPath: "sessions" }),
      webVersionCache: {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/${latestVersion}.html`,
      }
    });

    wspClient.on('qr', qr => qrcode.generate(qr, { small: true }));
    wspClient.on('ready', () => {
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