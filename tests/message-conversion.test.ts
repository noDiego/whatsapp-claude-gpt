import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AiMessage, AIProvider, AIRole } from '../src/interfaces/ai-interfaces';
import { CONFIG } from '../src/config';
import { convertIaMessagesLang } from '../src/bot/message-conversion';

const userTextMsg: AiMessage = {
  role: AIRole.USER, name: 'TestUser',
  content: [{ type: 'text', value: 'Hello there', author_id: 'user123',
    dateString: '2026-06-19T12:00:00Z', msg_id: 'msg_001' }]
};

const assistantMsg: AiMessage = {
  role: AIRole.ASSISTANT, name: 'Bot',
  content: [{ type: 'text', value: '{"message": "Hi!", "emojiReact": ""}',
    author_id: 'bot', dateString: '2026-06-19T12:01:00Z' }]
};

const userImgMsg: AiMessage = {
  role: AIRole.USER, name: 'TestUser',
  content: [{ type: 'image', value: 'base64data', mimetype: 'image/jpeg',
    author_id: 'user123', dateString: '2026-06-19T12:02:00Z', msg_id: 'msg_002' }]
};

const origProvider = (CONFIG as any).ChatConfig.provider;

describe('convertIaMessagesLang', () => {
  beforeEach(() => { (CONFIG as any).ChatConfig.provider = origProvider; });

  describe('OPENAI', () => {
    it('user text → input_text', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.OPENAI;
      const r = convertIaMessagesLang([userTextMsg]) as any[];
      assert.equal(r[0].role, AIRole.USER);
      assert.equal(r[0].content[0].type, 'input_text');
      assert.equal(JSON.parse(r[0].content[0].text).message, 'Hello there');
    });
    it('assistant text → output_text', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.OPENAI;
      const r = convertIaMessagesLang([assistantMsg]) as any[];
      assert.equal(r[0].content[0].type, 'output_text');
    });
    it('user image → input_image with data URI', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.OPENAI;
      const r = convertIaMessagesLang([userImgMsg]) as any[];
      assert.equal(r[0].content[0].type, 'input_image');
      assert.ok(r[0].content[0].image_url.startsWith('data:image/jpeg;base64,'));
    });
  });

  describe('CLAUDE', () => {
    it('first message is user role', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.CLAUDE;
      const r = convertIaMessagesLang([userTextMsg, assistantMsg]) as any[];
      assert.equal(r[0].role, AIRole.USER);
    });
    it('wraps text as { type: "text", text: JSON }', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.CLAUDE;
      const r = convertIaMessagesLang([userTextMsg]) as any[];
      assert.equal(r[0].content[0].type, 'text');
      assert.equal(JSON.parse(r[0].content[0].text).message, 'Hello there');
    });
    it('converts image to base64 source block', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.CLAUDE;
      const r = convertIaMessagesLang([userImgMsg]) as any[];
      const img = r[0].content.find((c: any) => c.type === 'image');
      assert.ok(img);
      assert.equal(img.source.type, 'base64');
      assert.equal(img.source.data, 'base64data');
    });
  });

  describe('DEEPSEEK', () => {
    it('user text → array content with type "text"', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.DEEPSEEK;
      const r = convertIaMessagesLang([userTextMsg]) as any[];
      assert.equal(r[0].role, AIRole.USER);
      assert.ok(Array.isArray(r[0].content));
      assert.equal(r[0].content[0].type, 'text');
    });
    it('assistant → string content', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.DEEPSEEK;
      const r = convertIaMessagesLang([assistantMsg]) as any[];
      assert.equal(typeof r[0].content, 'string');
    });
  });

  describe('QWEN', () => {
    it('wraps text as { type: "text" }', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.QWEN;
      const r = convertIaMessagesLang([userTextMsg]) as any[];
      assert.equal(r[0].content[0].type, 'text');
      assert.equal(r[0].name, 'TestUser');
    });
  });

  describe('CUSTOM / DEEPINFRA (toOther)', () => {
    it('CUSTOM works', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.CUSTOM;
      const r = convertIaMessagesLang([userTextMsg]) as any[];
      assert.equal(r[0].role, AIRole.USER);
    });
    it('DEEPINFRA works', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.DEEPINFRA;
      const r = convertIaMessagesLang([userTextMsg]) as any[];
      assert.equal(r[0].role, AIRole.USER);
    });
    it('assistant → string content', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.CUSTOM;
      const r = convertIaMessagesLang([assistantMsg]) as any[];
      assert.equal(typeof r[0].content, 'string');
    });
  });

  describe('unsupported provider', () => {
    it('throws for ELEVENLABS', () => {
      (CONFIG as any).ChatConfig.provider = AIProvider.ELEVENLABS;
      assert.throws(() => convertIaMessagesLang([userTextMsg]),
        /Unsupported chat provider/);
    });
  });
});

