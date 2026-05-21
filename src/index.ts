import logger from './logger';
import { connectWhatsApp } from "./bot/whatsapp-client";
import { configValidation, logConfigInfo } from "./utils";

require('dotenv').config();
configValidation()
logConfigInfo();

async function start() {
  try {
    await connectWhatsApp();
  } catch (e: any) {
    logger.error(`ERROR: ${e.message}`);
  }
}

start();
