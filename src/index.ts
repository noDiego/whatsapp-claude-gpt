import logger from './logger';
import { Message } from 'whatsapp-web.js';
import { Roboto } from './roboto';
import { configValidation, logConfigInfo } from './utils';

const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');
const client = new Client();

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
