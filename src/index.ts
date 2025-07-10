import logger from './logger';
import { Client, Message } from 'whatsapp-web.js';
import { logConfigInfo } from './utils';
import qrcode from 'qrcode-terminal';
import Roboto from "./roboto";

const client = new Client({
  // authStrategy: new LocalAuth()
});

require('dotenv').config();

logConfigInfo();

client.on('qr', qr => {
  qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
  logger.info('Client is ready!');
});

client.on('message', async (message: Message) => {
  Roboto.readMessage(message);
});

try {
  client.initialize();
}catch (e: any){
  logger.error(`ERROR: ${e.message}`);
}

export default client;