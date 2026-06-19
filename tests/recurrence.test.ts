import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Reminder } from '../src/interfaces/reminder';

// Import the singleton; side effects (DB init) happen at load time.
import Reminders from '../src/services/reminder-service';

// Access private method via characterization pattern (TS private, not #private).
const calcNext = (r: Partial<Reminder>) =>
  (Reminders as any).calculateNextRecurrence(r);

// Helper: build a minimal Reminder-like object
function makeReminder(overrides: Partial<Reminder>): Partial<Reminder> {
  return {
    id: 'test-1',
    message: 'test',
    reminderDate: '2026-06-19 12:00:00',
    reminderDateTZ: 'UTC',
    chatId: 'chat1',
    chatName: 'Test',
    isActive: true,
    recurrenceInterval: 1,
    ...overrides
  };
}

describe('calculateNextRecurrence', () => {

  it('returns null for recurrenceType "none"', () => {
    const r = makeReminder({ recurrenceType: 'none' });
    assert.equal(calcNext(r), null);
  });

  it('returns null for undefined recurrenceType', () => {
    const r = makeReminder({ recurrenceType: undefined });
    assert.equal(calcNext(r), null);
  });

  it('returns a Date for daily recurrence', () => {
    const r = makeReminder({ recurrenceType: 'daily' });
    const result = calcNext(r);
    assert.ok(result instanceof Date);
    // Should be 1 day after the reminder date
    const expected = new Date('2026-06-20T12:00:00Z');
    assert.equal(result.toISOString(), expected.toISOString());
  });

  it('returns a Date for weekly recurrence', () => {
    const r = makeReminder({ recurrenceType: 'weekly' });
    const result = calcNext(r);
    assert.ok(result instanceof Date);
    const expected = new Date('2026-06-26T12:00:00Z');
    assert.equal(result.toISOString(), expected.toISOString());
  });

  it('respects recurrenceInterval for daily', () => {
    const r = makeReminder({ recurrenceType: 'daily', recurrenceInterval: 3 });
    const result = calcNext(r);
    assert.ok(result instanceof Date);
    const expected = new Date('2026-06-22T12:00:00Z');
    assert.equal(result.toISOString(), expected.toISOString());
  });

  it('returns a Date for monthly recurrence', () => {
    const r = makeReminder({ recurrenceType: 'monthly' });
    const result = calcNext(r);
    assert.ok(result instanceof Date);
    const expected = new Date('2026-07-19T12:00:00Z');
    assert.equal(result.toISOString(), expected.toISOString());
  });

  it('returns a Date for minutes recurrence', () => {
    const r = makeReminder({ recurrenceType: 'minutes', recurrenceInterval: 30 });
    const result = calcNext(r);
    assert.ok(result instanceof Date);
    // 30 minutes = 30*60 seconds after the reminder date
    const base = new Date('2026-06-19T12:00:00Z');
    const expected = new Date(base.getTime() + 30 * 60 * 1000);
    assert.equal(result.toISOString(), expected.toISOString());
  });

  it('returns null when next date exceeds recurrenceEndDate', () => {
    const r = makeReminder({
      recurrenceType: 'daily',
      recurrenceEndDate: '2026-06-19 18:00:00',
      recurrenceEndDateTZ: 'UTC'
    });
    const result = calcNext(r);
    assert.equal(result, null);
  });

  it('returns Date when next date is before recurrenceEndDate', () => {
    const r = makeReminder({
      recurrenceType: 'daily',
      recurrenceEndDate: '2026-06-25 12:00:00',
      recurrenceEndDateTZ: 'UTC'
    });
    const result = calcNext(r);
    assert.ok(result instanceof Date);
  });
});
