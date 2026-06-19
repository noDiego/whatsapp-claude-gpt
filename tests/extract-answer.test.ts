import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnswer } from '../src/utils';

describe('extractAnswer', () => {

  const botName = 'TestBot';

  // --- null / empty / invalid input ---

  it('returns null for null input', () => {
    assert.equal(extractAnswer(null as any, botName), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(extractAnswer(undefined as any, botName), null);
  });

  it('returns null for empty string', () => {
    assert.equal(extractAnswer('', botName), null);
  });

  it('returns null for whitespace-only string', () => {
    assert.equal(extractAnswer('   ', botName), null);
  });

  // --- Attempt 1: Direct JSON parsing ---

  it('parses direct JSON with message field', () => {
    const input = '{"message": "hello", "type": "text", "author": "Bot"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'hello');
    assert.equal(result.type, 'text');
    assert.equal(result.author, 'Bot');
  });

  it('parses JSON with message: null (message !== undefined)', () => {
    const input = '{"message": null, "type": "text", "author": "Bot"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, null);
  });

  it('parses JSON with emojiReact', () => {
    const input = '{"message": "hi", "type": "text", "author": "Bot", "emojiReact": "👍"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.emojiReact, '👍');
  });

  // --- <think> tag stripping ---

  it('strips <think> tags before parsing', () => {
    const input = '<think>some reasoning here</think>{"message": "hello", "type": "text", "author": "Bot"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'hello');
  });

  it('strips multiple <think> tags', () => {
    const input = '<think>first</think><think>second</think>{"message": "hello", "type": "text", "author": "Bot"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'hello');
  });

  it('strips <think> tags with multiline content', () => {
    const input = '<think>\nreasoning\nmore reasoning\n</think>{"message": "result", "type": "text", "author": "Bot"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'result');
  });

  // --- Attempt 3: Regex-extracted JSON from mixed content ---

  it('extracts JSON from mixed text content', () => {
    const input = 'Here is my response: {"message": "extracted", "type": "text", "author": "Bot"} and more text';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'extracted');
  });

  // --- Fallback: plain text ---

  it('returns plain text as fallback when no JSON found', () => {
    const input = 'Hello there, how are you?';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'Hello there, how are you?');
    assert.equal(result.author, botName);
    assert.equal(result.type, 'text');
  });

  it('returns plain text when JSON has no message key', () => {
    const input = 'No JSON here at all';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, input);
    assert.equal(result.type, 'text');
    assert.equal(result.author, botName);
  });

  it('uses botName as author in plain text fallback', () => {
    const result = extractAnswer('simple text', 'MyBot');
    assert.equal(result.author, 'MyBot');
  });

  // --- JSON with newlines (fixJsonString) ---

  it('handles JSON strings with literal newlines inside values', () => {
    const input = '{"message": "line1\\nline2", "type": "text", "author": "Bot"}';
    const result = extractAnswer(input, botName);
    assert.equal(result.message, 'line1\nline2');
  });
});
