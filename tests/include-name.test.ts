import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { includeName } from '../src/utils';

describe('includeName', () => {

  it('returns false for empty name', () => {
    assert.equal(includeName('hello world', ''), false);
  });

  it('returns false for empty bodyMessage', () => {
    assert.equal(includeName('', 'Bot'), false);
  });

  it('returns false for null/undefined name', () => {
    assert.equal(includeName('hello', null as any), false);
    assert.equal(includeName('hello', undefined as any), false);
  });

  it('matches name at start of message', () => {
    assert.equal(includeName('Bot hello there', 'Bot'), true);
  });

  it('matches name at end of message', () => {
    assert.equal(includeName('hello Bot', 'Bot'), true);
  });

  it('matches name in middle of message', () => {
    assert.equal(includeName('hello Bot how are you', 'Bot'), true);
  });

  it('matches name followed by punctuation', () => {
    assert.equal(includeName('hello Bot!', 'Bot'), true);
    assert.equal(includeName('hello Bot?', 'Bot'), true);
    assert.equal(includeName('hello Bot.', 'Bot'), true);
  });

  it('matches name followed by comma', () => {
    assert.equal(includeName('hello Bot, how are you', 'Bot'), true);
  });

  it('is case insensitive', () => {
    assert.equal(includeName('hello BOT', 'bot'), true);
    assert.equal(includeName('hello bot', 'BOT'), true);
  });

  it('does not match name as substring of another word', () => {
    assert.equal(includeName('Roboto is here', 'Rob'), false);
  });

  it('handles names with regex special characters', () => {
    assert.equal(includeName('hello C++ world', 'C++'), true);
    assert.equal(includeName('ask Bot.v2 something', 'Bot.v2'), true);
  });

  it('does not match when name is not present', () => {
    assert.equal(includeName('hello world', 'Bot'), false);
  });
});
