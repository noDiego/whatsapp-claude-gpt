import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the singleton; side effects (DB init) happen at load time.
import Reminders from '../src/services/reminder-service';

// Access private methods via characterization pattern (TS private, not #private).
const isFatal = (errMsg: string) =>
  (Reminders as any).isFatalPuppeteerError(errMsg);

describe('isFatalPuppeteerError', () => {

    it('returns true for "Attempted to use detached Frame"', () => {
        assert.equal(isFatal('Attempted to use detached Frame'), true);
    });

    it('returns true for "Attempted to use detached Frame X" with id', () => {
        assert.equal(isFatal("Attempted to use detached Frame 'ABC123'"), true);
    });

    it('returns true for "Browser has been closed"', () => {
        assert.equal(isFatal('Browser has been closed'), true);
    });

    it('returns true for "Target closed"', () => {
        assert.equal(isFatal('Target closed'), true);
    });

    it('returns true for "Session closed"', () => {
        assert.equal(isFatal('Session closed'), true);
    });

    it('returns true for "Protocol error"', () => {
        assert.equal(isFatal('Protocol error'), true);
    });

    it('returns true for "Execution context was destroyed"', () => {
        assert.equal(isFatal('Execution context was destroyed'), true);
    });

    it('returns true for "Page has been closed"', () => {
        assert.equal(isFatal('Page has been closed'), true);
    });

    it('returns false for a normal Error message', () => {
        assert.equal(isFatal('Something went wrong'), false);
    });

    it('returns false for an empty string', () => {
        assert.equal(isFatal(''), false);
    });
});

describe('clearFatalErrors', () => {

    it('clears all tracked fatal reminder IDs', () => {
        // Seed the set
        (Reminders as any).fatalErrorReminders.add('id1');
        (Reminders as any).fatalErrorReminders.add('id2');
        assert.equal((Reminders as any).fatalErrorReminders.size, 2);

        // Clear it
        (Reminders as any).clearFatalErrors();
        assert.equal((Reminders as any).fatalErrorReminders.size, 0);
    });
});
