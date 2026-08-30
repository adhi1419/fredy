/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: debugLogStorage
 *
 * Backend-agnostic behavioral contract for the debug log recording feature.
 * Seeds and asserts ONLY through the public storage API (loaded via the harness
 * so the same suite runs against every backend). Every storage call is awaited.
 *
 * The debug log module interacts with settingsStorage for the enable/disable
 * flag — both modules are loaded through the harness for backend neutrality.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let debugLog;
let settingsStorage;

beforeAll(async () => {
  await initBackend();
  debugLog = await loadStorageModule('debugLogStorage');
  settingsStorage = await loadStorageModule('settingsStorage');
});

beforeEach(async () => {
  await resetBackend();
  // Reset in-memory caches between tests so each test starts fresh.
  if (typeof debugLog._resetForTests === 'function') {
    debugLog._resetForTests();
  }
});

afterAll(async () => {
  await teardownBackend();
});

describe('debugLogStorage contract', () => {
  // ---------------------------------------------------------------------------
  // Enable / disable flag
  // ---------------------------------------------------------------------------
  describe('enable/disable flag', () => {
    it('isEnabled returns false before enableDebugLogging is called', async () => {
      expect(await debugLog.isEnabled()).toBe(false);
    });

    it('enableDebugLogging flips the flag to true', async () => {
      await debugLog.enableDebugLogging();
      expect(await debugLog.isEnabled()).toBe(true);
    });

    it('disableDebugLogging flips the flag back to false', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.disableDebugLogging();
      expect(await debugLog.isEnabled()).toBe(false);
    });

    it('reloadEnabledFromSettings picks up persisted enabled state', async () => {
      // Persist the enabled flag via settingsStorage directly.
      await settingsStorage.upsertSettings({ debug_logging_enabled: true });
      const result = await debugLog.reloadEnabledFromSettings();
      expect(result).toBe(true);
      expect(await debugLog.isEnabled()).toBe(true);
    });

    it('reloadEnabledFromSettings picks up persisted disabled state', async () => {
      await debugLog.enableDebugLogging();
      // Externally flip the flag off (simulates a restart where settings say off).
      await settingsStorage.upsertSettings({ debug_logging_enabled: false });
      const result = await debugLog.reloadEnabledFromSettings();
      expect(result).toBe(false);
      expect(await debugLog.isEnabled()).toBe(false);
    });

    it('wasEverEnabled is false initially and true after first enable', async () => {
      expect(await debugLog.wasEverEnabled()).toBe(false);
      await debugLog.enableDebugLogging();
      expect(await debugLog.wasEverEnabled()).toBe(true);
    });

    it('wasEverEnabled remains true after disable', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.disableDebugLogging();
      expect(await debugLog.wasEverEnabled()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Log capture
  // ---------------------------------------------------------------------------
  describe('log capture', () => {
    it('appendLogEntry writes when enabled', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 100, level: 'info', message: 'hello-contract' });

      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('hello-contract');
      expect(logs[0].ts).toBe(100);
    });

    it('appendLogEntry is a no-op when disabled', async () => {
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'should-not-appear' });
      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(0);
    });

    it('disabling stops writes but preserves existing rows', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'keep-me' });
      await debugLog.disableDebugLogging();
      await debugLog.appendLogEntry({ ts: 2, level: 'info', message: 'never-written' });

      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('keep-me');
    });

    it('defaults missing ts to a number and missing level to "info"', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ message: 'bare-message' });

      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(1);
      expect(typeof logs[0].ts).toBe('number');
      expect(logs[0].level).toBe('info');
    });

    it('silently ignores entries without a string message', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry(null);
      await debugLog.appendLogEntry({});
      await debugLog.appendLogEntry({ message: 123 });

      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getAllDebugLogs ordering
  // ---------------------------------------------------------------------------
  describe('getAllDebugLogs', () => {
    it('returns rows ordered chronologically (insert order)', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'first' });
      await debugLog.appendLogEntry({ ts: 2, level: 'warn', message: 'second' });
      await debugLog.appendLogEntry({ ts: 3, level: 'error', message: 'third' });

      const logs = await debugLog.getAllDebugLogs();
      expect(logs.map((r) => r.message)).toEqual(['first', 'second', 'third']);
      expect(logs.map((r) => r.level)).toEqual(['info', 'warn', 'error']);
    });
  });

  // ---------------------------------------------------------------------------
  // hasAnyLogs
  // ---------------------------------------------------------------------------
  describe('hasAnyLogs', () => {
    it('returns false on empty table', async () => {
      expect(await debugLog.hasAnyLogs()).toBe(false);
    });

    it('returns true when logs exist', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'hi' });
      expect(await debugLog.hasAnyLogs()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // clearAllDebugLogs
  // ---------------------------------------------------------------------------
  describe('clearAllDebugLogs', () => {
    it('empties the table and resets the size', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'foo' });
      await debugLog.appendLogEntry({ ts: 2, level: 'info', message: 'bar' });
      expect(await debugLog.getCurrentSize()).toBeGreaterThan(0);

      await debugLog.clearAllDebugLogs();
      expect(await debugLog.getCurrentSize()).toBe(0);
      expect(await debugLog.hasAnyLogs()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // enableDebugLogging clearPrevious option
  // ---------------------------------------------------------------------------
  describe('enableDebugLogging clearPrevious', () => {
    it('preserves previous logs by default', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'pre-existing' });
      await debugLog.disableDebugLogging();

      await debugLog.enableDebugLogging({ clearPrevious: false });
      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(1);
    });

    it('clears previous logs when clearPrevious=true', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'doomed' });
      await debugLog.disableDebugLogging();

      await debugLog.enableDebugLogging({ clearPrevious: true });
      const logs = await debugLog.getAllDebugLogs();
      expect(logs).toHaveLength(0);
      expect(await debugLog.getCurrentSize()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentSize / getMaxSize
  // ---------------------------------------------------------------------------
  describe('size tracking', () => {
    it('getCurrentSize reflects the stored byte total', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'hello' }); // 5 bytes
      await debugLog.appendLogEntry({ ts: 2, level: 'info', message: 'world!' }); // 6 bytes
      expect(await debugLog.getCurrentSize()).toBe(11);
    });

    it('getMaxSize returns the 5 MiB constant', () => {
      expect(debugLog.getMaxSize()).toBe(5 * 1024 * 1024);
    });

    it('MAX_DEBUG_LOG_BYTES is exported and equals getMaxSize()', () => {
      expect(debugLog.MAX_DEBUG_LOG_BYTES).toBe(debugLog.getMaxSize());
    });

    it('size stays consistent across enable → append → disable → re-enable(clear) cycles', async () => {
      await debugLog.enableDebugLogging();
      await debugLog.appendLogEntry({ ts: 1, level: 'info', message: 'one' });
      await debugLog.appendLogEntry({ ts: 2, level: 'info', message: 'two' });
      const sizeAfterFirst = await debugLog.getCurrentSize();

      await debugLog.disableDebugLogging();
      expect(await debugLog.getCurrentSize()).toBe(sizeAfterFirst);

      await debugLog.enableDebugLogging({ clearPrevious: true });
      expect(await debugLog.getCurrentSize()).toBe(0);

      await debugLog.appendLogEntry({ ts: 3, level: 'info', message: 'fresh' });
      expect(await debugLog.getCurrentSize()).toBe(Buffer.byteLength('fresh', 'utf-8'));
    });
  });

  // ---------------------------------------------------------------------------
  // Rolling buffer trim (5 MiB cap)
  //
  // NOTE: Firestore has a 1 MiB per-document limit, so tests use multiple
  // moderate-sized entries rather than a single giant one to trigger the cap.
  // ---------------------------------------------------------------------------
  describe('rolling buffer trim', () => {
    it('drops oldest entries when total size exceeds the cap', async () => {
      await debugLog.enableDebugLogging();
      const cap = debugLog.getMaxSize();

      // Fill exactly the cap with multiple ~500KB rows.
      const chunkSize = 500_000;
      const numChunks = Math.ceil(cap / chunkSize);
      for (let i = 0; i < numChunks; i++) {
        const size = i < numChunks - 1 ? chunkSize : cap - chunkSize * (numChunks - 1);
        await debugLog.appendLogEntry({ ts: i, level: 'info', message: 'O'.repeat(size) });
      }

      // This tips over the cap — oldest rows must be evicted.
      await debugLog.appendLogEntry({ ts: 999, level: 'warn', message: 'tip-over message' });

      const logs = await debugLog.getAllDebugLogs();
      // The tip-over message must survive.
      expect(logs.map((r) => r.message)).toContain('tip-over message');

      const remainingSize = await debugLog.getCurrentSize();
      expect(remainingSize).toBeLessThanOrEqual(cap);
    });

    it('evicts everything when total inserted size greatly exceeds the cap', async () => {
      await debugLog.enableDebugLogging();
      const cap = debugLog.getMaxSize();

      // Insert many rows that collectively exceed the cap, then one more giant push.
      const chunkSize = 500_000;
      const numChunks = Math.ceil((cap + 500_000) / chunkSize);
      for (let i = 0; i < numChunks; i++) {
        await debugLog.appendLogEntry({ ts: i, level: 'info', message: 'Z'.repeat(chunkSize) });
      }

      // After all the trims, size must be under cap.
      const remainingSize = await debugLog.getCurrentSize();
      expect(remainingSize).toBeLessThanOrEqual(cap);
    });

    it('preserves multiple newer rows when only the oldest needs eviction', async () => {
      await debugLog.enableDebugLogging();
      const cap = debugLog.getMaxSize();

      // Fill exactly the cap with multiple chunks.
      const chunkSize = 500_000;
      const numChunks = Math.ceil(cap / chunkSize);
      for (let i = 0; i < numChunks; i++) {
        const size = i < numChunks - 1 ? chunkSize : cap - chunkSize * (numChunks - 1);
        await debugLog.appendLogEntry({ ts: i, level: 'info', message: 'B'.repeat(size) });
      }

      // This 7-byte row pushes us over the cap. At least one oldest chunk must be evicted.
      await debugLog.appendLogEntry({ ts: 100, level: 'info', message: 'small-a' });
      // Another small row — both should survive.
      await debugLog.appendLogEntry({ ts: 101, level: 'info', message: 'small-b' });

      const logs = await debugLog.getAllDebugLogs();
      const messages = logs.map((r) => r.message);
      expect(messages).toContain('small-a');
      expect(messages).toContain('small-b');

      const remainingSize = await debugLog.getCurrentSize();
      expect(remainingSize).toBeLessThanOrEqual(cap);
    });
  });
});
