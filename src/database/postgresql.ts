import {Client} from 'pg';
import { ChatCfg } from '../interfaces/chatconfig';
import logger from "../logger";
import { CONFIG } from '../config';
require('dotenv').config();

const config: any = {
  user: CONFIG.dbConfig.user,
  password: CONFIG.dbConfig.password,
  host: CONFIG.dbConfig.host,
  port: CONFIG.dbConfig.port,
  database: CONFIG.dbConfig.database,
  keepAlive: false
}

export class PostgresClient {
  private static instance: PostgresClient;
  private client: Client;
  private lastQueryTime: Date = new Date();
  private isConnected = false;
  private tiempoInactividad = 2 * 60 * 1000; // 10 minutos
  private schema = CONFIG.dbConfig.schema;

  constructor() {
    this.startTimer();
  }

  private async getClient(){
    if(!this.isConnected) {
      this.client = new Client(config);
      await this.client.connect();
      this.isConnected = true;
      logger.debug(JSON.stringify(config));
      logger.info('PSQL Connected');
    }
    this.lastQueryTime = new Date();
    return this.client;
  }

  private startTimer(){
    setInterval(async () => {
      const timeSinceLastQuery = new Date().getTime() - this.lastQueryTime.getTime();
      if (this.isConnected && timeSinceLastQuery > this.tiempoInactividad) {
        await this.client.end();
        this.isConnected = false;
        logger.info('PostgreSQL disconnected due to inactivity');
      }
    }, this.tiempoInactividad);
  }

  public static getInstance(): PostgresClient {
    if (!PostgresClient.instance) {
      PostgresClient.instance = new PostgresClient();
    }
    return PostgresClient.instance;
  }

  private async query(sql: string, params: any[] = []): Promise<any> {

    const client = await this.getClient();

    try {
      const result = await client.query(sql, params);
      return result.rows;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  public async getChatConfigs(): Promise<ChatCfg[]>{
    const query = `SELECT * FROM ${this.schema}.chats_cfg p`;
    const rows = await this.query(query, []);
    return rows as ChatCfg[];
  }

}
