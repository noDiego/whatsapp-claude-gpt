import { Message } from 'whatsapp-web.js';
import { Roboto } from './roboto';
import logger from './logger';

const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');
const client = new Client();

const roboto: Roboto = new Roboto();
require('dotenv').config();

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
