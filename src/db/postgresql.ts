import { Pool, PoolClient } from 'pg';
import logger from "../logger";
import { CONFIG } from '../config';
import { ChatConfiguration } from "../interfaces/chat-configuration";
require('dotenv').config();

const poolConfig = {
    user: CONFIG.DBConfig.user,
    password: CONFIG.DBConfig.password,
    host: CONFIG.DBConfig.host,
    port: CONFIG.DBConfig.port,
    database: CONFIG.DBConfig.database,
    max: 20,
    idleTimeoutMillis: 30 * 60 * 1000,
    connectionTimeoutMillis: 5000
}

export class PostgresClient {
    private static instance: PostgresClient;
    private pool: Pool;
    private schema = CONFIG.DBConfig.schema;

    constructor() {
        this.pool = new Pool(poolConfig);

        // Handle pool errors
        this.pool.on('error', (err) => {
            logger.error('Unexpected error on idle client', err);
        });

        logger.info('PostgreSQL pool initialized');
    }

    public static getInstance(): PostgresClient {
        if (!PostgresClient.instance) {
            PostgresClient.instance = new PostgresClient();
        }
        return PostgresClient.instance;
    }

    private async query(sql: string, params: any[] = []): Promise<any> {
        const client = await this.pool.connect();

        try {
            const result = await client.query(sql, params);
            return result.rows;
        } catch (error) {
            logger.error('Database query error:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Maps database column names (snake_case) to ChatConfiguration properties (camelCase)
     */
    private mapToChatConfiguration(row: any): ChatConfiguration {
        return {
            id: row.id,
            name: row.name,
            promptInfo: row.prompt_info,
            botName: row.bot_name,
            maxImages: row.max_images,
            maxMsgsLimit: row.max_msgs_limit,
            maxHoursLimit: row.max_hours_limit,
            chatModel: row.chat_model,
            imageModel: row.image_model,
            ttsProvider: row.tts_provider,
            ttsModel: row.tts_model,
            ttsVoice: row.tts_voice,
            sttModel: row.stt_model,
            sttLanguage: row.stt_language,
            imageCreationEnabled: row.image_creation_enabled,
            voiceCreationEnabled: row.voice_creation_enabled
        };
    }

    /**
     * Get all chat configurations
     */
    public async getChatConfigs(): Promise<ChatConfiguration[]> {
        const query = `
            SELECT * 
            FROM ${this.schema}.chat_config
            ORDER BY name
        `;
        const rows = await this.query(query, []);
        return rows.map(row => this.mapToChatConfiguration(row));
    }

    /**
     * Get a single chat configuration by ID
     */
    public async getChatConfigById(id: string): Promise<ChatConfiguration | null> {
        const query = `
            SELECT * 
            FROM ${this.schema}.chat_config
            WHERE id = $1
        `;
        const rows = await this.query(query, [id]);

        if (rows.length === 0) {
            return null;
        }

        return this.mapToChatConfiguration(rows[0]);
    }

    /**
     * Create a new chat configuration
     */
    public async createChatConfig(config: ChatConfiguration): Promise<ChatConfiguration> {
        const query = `
            INSERT INTO ${this.schema}.chat_config (
                id, name, prompt_info, bot_name, max_images, 
                max_msgs_limit, max_hours_limit, chat_model, image_model, 
                tts_provider, tts_model, tts_voice, stt_model, stt_language,
                image_creation_enabled, voice_creation_enabled
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING *
        `;

        const values = [
            config.id,
            config.name,
            config.promptInfo,
            config.botName,
            config.maxImages,
            config.maxMsgsLimit,
            config.maxHoursLimit,
            config.chatModel,
            config.imageModel,
            config.ttsProvider,
            config.ttsModel,
            config.ttsVoice,
            config.sttModel,
            config.sttLanguage,
            config.imageCreationEnabled,
            config.voiceCreationEnabled
        ];

        const rows = await this.query(query, values);
        return this.mapToChatConfiguration(rows[0]);
    }

    /**
     * Update an existing chat configuration
     */
    public async updateChatConfig(id: string, config: Partial<ChatConfiguration>): Promise<ChatConfiguration | null> {
        // Get current configuration to handle partial updates
        const currentConfig = await this.getChatConfigById(id);
        if (!currentConfig) {
            return null;
        }

        // Build update query dynamically based on provided fields
        const updateFields: string[] = [];
        const values: any[] = [];
        let paramCounter = 1;

        // Helper function to add a field to the update query if it exists in config
        const addField = (fieldName: string, dbFieldName: string, value: any) => {
            if (value !== undefined) {
                updateFields.push(`${dbFieldName} = $${paramCounter}`);
                values.push(value);
                paramCounter++;
            }
        };

        // Add each field that exists in the partial config
        addField('name', 'name', config.name);
        addField('promptInfo', 'prompt_info', config.promptInfo);
        addField('botName', 'bot_name', config.botName);
        addField('maxImages', 'max_images', config.maxImages);
        addField('maxMsgsLimit', 'max_msgs_limit', config.maxMsgsLimit);
        addField('maxHoursLimit', 'max_hours_limit', config.maxHoursLimit);
        addField('chatModel', 'chat_model', config.chatModel);
        addField('imageModel', 'image_model', config.imageModel);
        addField('ttsProvider', 'tts_provider', config.ttsProvider);
        addField('ttsModel', 'tts_model', config.ttsModel);
        addField('ttsVoice', 'tts_voice', config.ttsVoice);
        addField('sttModel', 'stt_model', config.sttModel);
        addField('sttLanguage', 'stt_language', config.sttLanguage);
        addField('imageCreationEnabled', 'image_creation_enabled', config.imageCreationEnabled);
        addField('voiceCreationEnabled', 'voice_creation_enabled', config.voiceCreationEnabled);

        // If no fields to update, return the current config
        if (updateFields.length === 0) {
            return currentConfig;
        }

        // Add ID to values array
        values.push(id);

        // Construct and execute the query
        const query = `
            UPDATE ${this.schema}.chat_config
            SET ${updateFields.join(', ')}
            WHERE id = $${paramCounter}
            RETURNING *
        `;

        const rows = await this.query(query, values);
        if (rows.length === 0) {
            return null;
        }

        return this.mapToChatConfiguration(rows[0]);
    }

    /**
     * Delete a chat configuration by ID
     */
    public async deleteChatConfig(id: string): Promise<boolean> {
        const query = `
            DELETE FROM ${this.schema}.chat_config
            WHERE id = $1
            RETURNING id
        `;

        const rows = await this.query(query, [id]);
        return rows.length > 0;
    }

    // For proper application shutdown
    public async close(): Promise<void> {
        await this.pool.end();
        logger.info('PostgreSQL pool has ended');
    }
}