import logger from './logger';
import { Message } from 'whatsapp-web.js';
import { Roboto } from './roboto';
import { configValidation, logConfigInfo } from './utils';
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';

const client = new Client({
  authStrategy: new LocalAuth()
});

require('dotenv').config();

configValidation();
logConfigInfo();

const roboto: Roboto = new Roboto();

client.on('qr', qr => {
  qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
  logger.info('Client is ready!');
});

client.on('message', async (message: Message) => {
  roboto.readMessage(message, client);
});

try {
  client.initialize();
}catch (e: any){
  logger.error(`ERROR: ${e.message}`);
}
