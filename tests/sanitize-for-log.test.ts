import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForLog } from '../src/utils';

describe('sanitizeForLog', () => {

  it('passes null through', () => {
    assert.equal(sanitizeForLog(null), null);
  });

  it('passes undefined through', () => {
    assert.equal(sanitizeForLog(undefined), undefined);
  });

  it('passes numbers through', () => {
    assert.equal(sanitizeForLog(42), 42);
  });

  it('passes booleans through', () => {
    assert.equal(sanitizeForLog(true), true);
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer sk-abc123def456';
    const result = sanitizeForLog(input);
    assert.ok(!result.includes('sk-abc123def456'));
    assert.ok(result.includes('REDACTED'));
  });

  it('redacts sk- API keys', () => {
    const input = 'key is sk-proj-abc123def456';
    const result = sanitizeForLog(input);
    assert.ok(!result.includes('sk-proj-abc123def456'));
    assert.ok(result.includes('sk-***REDACTED***'));
  });

  it('redacts api-key patterns', () => {
    const input = 'api_key=abc123def456';
    const result = sanitizeForLog(input);
    assert.ok(!result.includes('abc123def456'));
    assert.ok(result.includes('REDACTED'));
  });

  it('redacts xi-api-key patterns', () => {
    const input = 'xi-api-key=abc123def456';
    const result = sanitizeForLog(input);
    assert.ok(!result.includes('abc123def456'));
    assert.ok(result.includes('REDACTED'));
  });

  it('redacts phone numbers (7+ digits)', () => {
    const input = 'call me at +5491155667788';
    const result = sanitizeForLog(input);
    assert.ok(!result.includes('5491155667788'));
    assert.ok(result.includes('***PHONE***'));
  });

  it('redacts base64 image data', () => {
    const base64 = 'A'.repeat(100);
    const input = `data:image/jpeg;base64,${base64}`;
    const result = sanitizeForLog(input);
    assert.ok(!result.includes(base64));
    assert.ok(result.includes('data:image/jpeg;base64,***REDACTED***'));
  });

  it('truncates strings longer than 500 characters', () => {
    const input = 'a'.repeat(600);
    const result = sanitizeForLog(input);
    assert.equal(result.length, 503); // 500 + '...'
    assert.ok(result.endsWith('...'));
  });

  it('does not truncate strings of 500 chars or less', () => {
    const input = 'a'.repeat(500);
    const result = sanitizeForLog(input);
    assert.equal(result.length, 500);
  });

  it('redacts sensitive keys in objects', () => {
    const input = { apiKey: 'secret123', name: 'test' };
    const result = sanitizeForLog(input);
    assert.equal(result.apiKey, '***REDACTED***');
    assert.equal(result.name, 'test');
  });

  it('redacts nested sensitive keys recursively', () => {
    const input = { config: { token: 'secret', value: 'ok' } };
    const result = sanitizeForLog(input);
    assert.equal(result.config.token, '***REDACTED***');
    assert.equal(result.config.value, 'ok');
  });

  it('handles Error objects', () => {
    const err = new Error('test error');
    const result = sanitizeForLog(err);
    assert.equal(result.message, 'test error');
    assert.equal(result.name, 'Error');
    assert.ok(result.stack);
  });

  it('limits arrays to 20 elements', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    const result = sanitizeForLog(input);
    assert.equal(result.length, 20);
  });

  it('sanitizes array elements recursively', () => {
    const input = [{ apiKey: 'secret' }];
    const result = sanitizeForLog(input);
    assert.equal(result[0].apiKey, '***REDACTED***');
  });
});
