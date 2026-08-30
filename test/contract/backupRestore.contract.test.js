/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: backupRestoreService (Firestore-only)
 *
 * The SQLite backup service already has its own test suite (test/backup/).
 * This file validates the Firestore-specific implementation: JSON-per-collection
 * zip format, subcollection round-trip (travel_times, price_history), and
 * manifest validation.
 *
 * Skipped entirely on the sqlite backend.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule, backendName } from './harness.js';

let backupRestoreService;
let userStorage;
let jobStorage;
let listingsStorage;

beforeAll(async () => {
  await initBackend();
  backupRestoreService = await loadStorageModule('backupRestoreService');
  userStorage = await loadStorageModule('userStorage');
  jobStorage = await loadStorageModule('jobStorage');
  listingsStorage = await loadStorageModule('listingsStorage');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

describe.skipIf(backendName() !== 'firestore')('backupRestoreService contract (Firestore)', () => {
  // ── Seed helpers (match existing contract test patterns) ────────────

  async function seedUser(username = `user_${Date.now()}`) {
    await userStorage.upsertUser({ username, password: 'testpass123', isAdmin: false });
    const users = await userStorage.getUsers();
    return users.find((u) => u.username === username);
  }

  async function seedJob(userId, name = 'Test Job') {
    await jobStorage.upsertJob({
      name,
      enabled: true,
      dealType: 'rent',
      blacklist: [],
      filter: {},
      notificationAdapter: [],
      appliedAdapter: [],
      userId,
    });
    const jobs = await jobStorage.getJobs({ includeDisabled: true });
    return jobs.find((j) => j.name === name);
  }

  async function seedListings(jobId, providerId, items) {
    const listings = items.map((item, i) => ({
      id: item.id ?? `hash_${i}`,
      title: item.title ?? `Listing ${i}`,
      price: item.price ?? 500 + i * 100,
      size: item.size ?? 50,
      rooms: item.rooms ?? 2,
      address: item.address ?? 'Test Street 1',
      link: item.link ?? 'https://example.com',
      ...item,
    }));
    await listingsStorage.storeListings(jobId, providerId, listings);
    return listings;
  }

  // ── createBackupZip ─────────────────────────────────────────────────

  describe('createBackupZip', () => {
    it('produces a valid zip buffer', async () => {
      const buf = await backupRestoreService.createBackupZip();
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('zip contains manifest.json with expected format', async () => {
      const buf = await backupRestoreService.createBackupZip();
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(buf);
      const entry = zip.getEntry('manifest.json');
      expect(entry).not.toBeNull();
      const manifest = JSON.parse(entry.getData().toString('utf-8'));
      expect(manifest.format).toBe('firestore-json-v1');
      expect(manifest.createdAt).toBeTruthy();
      expect(manifest.fredyVersion).toBeTruthy();
    });

    it('zip contains collection JSON files', async () => {
      await seedUser('backupuser');
      const buf = await backupRestoreService.createBackupZip();
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(buf);
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names).toContain('users.json');
      expect(names).toContain('jobs.json');
      expect(names).toContain('listings.json');
      expect(names).toContain('manifest.json');
      expect(names).toContain('travel_times.json');
      expect(names).toContain('price_history.json');
    });

    it('seeded users appear in the backup', async () => {
      await seedUser('alice');
      const buf = await backupRestoreService.createBackupZip();
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(buf);
      const users = JSON.parse(zip.getEntry('users.json').getData().toString('utf-8'));
      expect(users.some((u) => u.username === 'alice')).toBe(true);
    });
  });

  // ── precheckRestore ─────────────────────────────────────────────────

  describe('precheckRestore', () => {
    it('rejects empty buffer', async () => {
      const result = await backupRestoreService.precheckRestore(Buffer.alloc(0));
      expect(result.compatible).toBe(false);
      expect(result.severity).toBe('danger');
    });

    it('rejects zip without manifest', async () => {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();
      zip.addFile('random.txt', Buffer.from('hello'));
      const result = await backupRestoreService.precheckRestore(zip.toBuffer());
      expect(result.compatible).toBe(false);
      expect(result.severity).toBe('danger');
    });

    it('rejects zip with wrong format version', async () => {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();
      zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'unknown-v99' })));
      const result = await backupRestoreService.precheckRestore(zip.toBuffer());
      expect(result.compatible).toBe(false);
      expect(result.severity).toBe('danger');
      expect(result.message).toContain('unknown-v99');
    });

    it('accepts a valid backup zip', async () => {
      await seedUser('checkuser');
      const buf = await backupRestoreService.createBackupZip();
      const result = await backupRestoreService.precheckRestore(buf);
      expect(result.compatible).toBe(true);
      expect(result.severity).toBe('info');
    });
  });

  // ── restoreFromZip ──────────────────────────────────────────────────

  describe('restoreFromZip', () => {
    it('throws INCOMPATIBLE when precheck fails and force is not set', async () => {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();
      zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'bad' })));
      const buf = zip.toBuffer();
      await expect(backupRestoreService.restoreFromZip(buf)).rejects.toThrow(/Unsupported backup format/);
    });

    it('round-trips users through backup + restore', async () => {
      await seedUser('roundtrip_user');

      const buf = await backupRestoreService.createBackupZip();
      await resetBackend();

      const usersAfterWipe = await userStorage.getUsers();
      expect(usersAfterWipe.some((u) => u.username === 'roundtrip_user')).toBe(false);

      const result = await backupRestoreService.restoreFromZip(buf);
      expect(result.restored).toBe(true);

      const usersAfterRestore = await userStorage.getUsers();
      expect(usersAfterRestore.some((u) => u.username === 'roundtrip_user')).toBe(true);
    });

    it('round-trips jobs through backup + restore', async () => {
      const user = await seedUser('job_owner');
      await seedJob(user.id, 'Backup Test Job');

      const buf = await backupRestoreService.createBackupZip();
      await resetBackend();

      await backupRestoreService.restoreFromZip(buf);
      const jobs = await jobStorage.getJobs({ includeDisabled: true });
      expect(jobs.some((j) => j.name === 'Backup Test Job')).toBe(true);
    });

    it('round-trips listings through backup + restore', async () => {
      const user = await seedUser('listing_owner');
      const job = await seedJob(user.id, 'Listing Job');
      await seedListings(job.id, 'immoscout', [{ id: 'abc123', title: 'Nice Flat', price: 750 }]);

      const hashes = await listingsStorage.getKnownListingHashesForJobAndProvider(job.id, 'immoscout');
      expect(hashes).toContain('abc123');

      const buf = await backupRestoreService.createBackupZip();
      await resetBackend();

      await backupRestoreService.restoreFromZip(buf);

      const hashesAfter = await listingsStorage.getKnownListingHashesForJobAndProvider(job.id, 'immoscout');
      expect(hashesAfter).toContain('abc123');
    });

    it('round-trips travel_times subcollection through backup + restore', async () => {
      const user = await seedUser('travel_owner');
      const job = await seedJob(user.id, 'Travel Job');
      const items = [{ id: 'tt_hash_1', title: 'Place with Travel', price: 800 }];
      const seeded = await seedListings(job.id, 'immoscout', items);
      const listingId = seeded[0].id; // mutated by storeListings to the doc id

      const travelEntries = [
        { label: 'Office', originLat: 52.52, originLng: 13.405, transitMinutes: 25, carMinutes: 15 },
        { label: 'Gym', originLat: 52.51, originLng: 13.41, transitMinutes: 10, carMinutes: 8 },
      ];
      await listingsStorage.saveListingTravelTimes(listingId, travelEntries);

      const ttBefore = await listingsStorage.getTravelTimesForListings([listingId]);
      expect(ttBefore.get(listingId)).toHaveLength(2);

      const buf = await backupRestoreService.createBackupZip();
      await resetBackend();

      await backupRestoreService.restoreFromZip(buf);

      const ttAfter = await listingsStorage.getTravelTimesForListings([listingId]);
      expect(ttAfter.has(listingId)).toBe(true);
      const restored = ttAfter.get(listingId);
      expect(restored).toHaveLength(2);
      const labels = restored.map((t) => t.label);
      expect(labels).toContain('Office');
      expect(labels).toContain('Gym');
    });

    it('restore wipes pre-existing data before importing', async () => {
      // Create backup with new_user
      await seedUser('new_user');
      const buf = await backupRestoreService.createBackupZip();

      // Reset and seed old_user
      await resetBackend();
      await seedUser('old_user');

      // Restore — old_user should be gone, new_user present
      await backupRestoreService.restoreFromZip(buf);
      const users = await userStorage.getUsers();
      expect(users.some((u) => u.username === 'new_user')).toBe(true);
      expect(users.some((u) => u.username === 'old_user')).toBe(false);
    });

    it('returns warning when precheck severity is not info', async () => {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();
      zip.addFile(
        'manifest.json',
        Buffer.from(JSON.stringify({ format: 'firestore-json-v1', createdAt: new Date().toISOString() })),
      );
      const buf = zip.toBuffer();

      const result = await backupRestoreService.restoreFromZip(buf);
      expect(result.restored).toBe(true);
      expect(result.warning).toBeTruthy();
    });
  });

  // ── buildBackupFileName ─────────────────────────────────────────────

  describe('buildBackupFileName', () => {
    it('returns a string matching the expected pattern', async () => {
      const name = await backupRestoreService.buildBackupFileName();
      expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-FredyBackup-.+\.zip$/);
    });
  });
});
