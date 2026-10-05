/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Seeds the local Firestore EMULATOR with the demo data the README screenshots are taken from.
// Refuses to run without FIRESTORE_EMULATOR_HOST so it can never touch production.
// usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 node scripts/screenshots/seed-demo.cjs <firebaseUid>
// The uid is the one the Auth emulator minted for your dev account (see docs, section 4).
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('refusing: FIRESTORE_EMULATOR_HOST is not set');
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore({ projectId: process.env.FIRESTORE_PROJECT_ID || 'demo-fredy' });
const userId = process.argv[2];
if (!userId) throw new Error('userId required');

const now = Date.now();
const h = (n) => now - n * 3600_000;
const PHOTOS = ["1502672260266-1c1ef2d93688", "1522708323590-d24dbb6b0267", "1484154218962-a197022b5858", "1493809842364-78817add7ffb", "1536376072261-38c75010e6c9", "1502005229762-cf1b2da7c5d6", "1560448204-e02f11c3d0e2", "1512917774080-9991f1c4c750", "1505691938895-1758d7feb511", "1554995207-c18c203602cb", "1560185007-c5ca9d2c014d", "1515263487990-61b07816b324", "1600585154340-be6161a56a0c", "1600566753190-17f0baa2a6c3"];
const img = (n) => `https://images.unsplash.com/photo-${PHOTOS[n % PHOTOS.length]}?w=960&h=720&fit=crop`;
const policy = (state) => ({ state, consentAt: state === 'auto' ? now : null });

const jobs = [
  {
    id: 'job-berlin', name: 'Berlin Rentals', dealType: 'rent', enabled: true,
    provider: [
      { id: 'immoscout', name: 'ImmoScout24', url: 'https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten?numberofrooms=2.0-&price=-1600.0', enabled: true, applicationPolicy: policy('auto') },
      { id: 'kleinanzeigen', name: 'Kleinanzeigen', url: 'https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/preis::1600/c203l3331+wohnung_mieten.zimmer_d:2%2C', enabled: true, applicationPolicy: policy('off') },
      { id: 'inberlinwohnen', name: 'InBerlinWohnen', url: 'https://inberlinwohnen.de/wohnungsfinder/', enabled: true, applicationPolicy: policy('auto') },
    ],
  },
  {
    id: 'job-munich', name: 'Munich Apartments', dealType: 'rent', enabled: true,
    provider: [
      { id: 'immoscout', name: 'ImmoScout24', url: 'https://www.immobilienscout24.de/Suche/de/bayern/muenchen/wohnung-mieten?numberofrooms=2.0-&price=-1900.0', enabled: true, applicationPolicy: policy('off') },
    ],
  },
];

const listings = [
  ['job-berlin', 'immoscout', 'Helle 2-Zimmer-Wohnung mit Balkon in Prenzlauer Berg', 'Kastanienallee 28, 10435 Berlin', 1290, 58, 2, 52.5372, 13.4071, 'new', 2],
  ['job-berlin', 'inberlinwohnen', 'Altbau mit Dielen und Stuck, Kreuzberg', 'Graefestraße 12, 10967 Berlin', 1150, 64, 2, 52.4927, 13.4201, 'new', 5],
  ['job-berlin', 'kleinanzeigen', '3 Zimmer Neubau, Erstbezug, Friedrichshain', 'Boxhagener Straße 76, 10245 Berlin', 1590, 78, 3, 52.5096, 13.4612, 'new', 9],
  ['job-berlin', 'immoscout', 'Ruhige 2-Zimmer-Wohnung am Volkspark', 'Danziger Straße 101, 10405 Berlin', 1080, 52, 2, 52.5400, 13.4280, 'new', 14],
  ['job-berlin', 'inberlinwohnen', 'Dachgeschoss mit Terrasse in Neukölln', 'Weserstraße 45, 12045 Berlin', 1420, 71, 2.5, 52.4835, 13.4297, 'new', 20],
  ['job-berlin', 'immoscout', 'Sanierte 2-Zimmer-Wohnung in Moabit', 'Turmstraße 60, 10551 Berlin', 990, 49, 2, 52.5262, 13.3398, 'new', 27],
  ['job-berlin', 'kleinanzeigen', 'Gemütliche Wohnung mit Garten, Schöneberg', 'Akazienstraße 9, 10823 Berlin', 1340, 60, 2, 52.4873, 13.3517, 'applied', 40],
  ['job-berlin', 'immoscout', '2 Zimmer mit Einbauküche, Charlottenburg', 'Kantstraße 112, 10627 Berlin', 1250, 55, 2, 52.5061, 13.3042, 'applied', 48],
  ['job-berlin', 'inberlinwohnen', 'Maisonette am Landwehrkanal', 'Paul-Lincke-Ufer 20, 10999 Berlin', 1480, 69, 3, 52.4939, 13.4260, 'viewed', 70],
  ['job-berlin', 'immoscout', 'Wohnung mit Loggia, Wedding', 'Müllerstraße 148, 13353 Berlin', 870, 46, 1.5, 52.5493, 13.3620, 'archived', 120],
  ['job-berlin', 'kleinanzeigen', 'Erdgeschoss mit Hof, Lichtenberg', 'Frankfurter Allee 220, 10365 Berlin', 940, 57, 2, 52.5142, 13.4969, 'archived', 150],
  ['job-munich', 'immoscout', '2-Zimmer-Wohnung in Schwabing-West', 'Hohenzollernstraße 40, 80801 München', 1690, 54, 2, 48.1626, 11.5718, 'new', 3],
  ['job-munich', 'immoscout', 'Helle Wohnung am Westpark', 'Hansastraße 125, 81373 München', 1480, 61, 2, 48.1222, 11.5180, 'new', 16],
  ['job-munich', 'immoscout', 'Dachgeschoss in Haidhausen', 'Wörthstraße 18, 81667 München', 1850, 72, 3, 48.1300, 11.5990, 'viewed', 60],
];

(async () => {
  const batch = db.batch();
  for (const j of jobs) {
    batch.set(db.collection('jobs').doc(j.id), {
      userId, enabled: j.enabled, name: j.name, blacklist: [], provider: j.provider, notificationAdapter: [],
      sharedWithUser: [], dealType: j.dealType, createdAt: h(240), lastRunAt: h(1),
    });
  }
  listings.forEach(([jobId, provider, title, address, price, size, rooms, lat, lng, state, ageH], i) => {
    const createdAt = h(ageH);
    batch.set(db.collection('listings').doc(`demo-${i + 1}`), {
      jobId, provider, title, address, price, size, rooms, latitude: lat, longitude: lng,
      hash: `demo-${i + 1}`, link: `https://example.org/listing/${i + 1}`, imageUrl: img(i),
      description: null, buildYear: null, energyClass: null, distances: null, notes: null,
      isActive: true, manuallyDeleted: false, createdAt,
      inquiryMessage: null, inquirySendStatus: state === 'applied' ? 'sent' : null, inquirySendStartedAt: null,
      inquirySentAt: state === 'applied' ? createdAt + 600_000 : null, inquiryRequestId: null, inquirySendError: null,
      notificationComplete: true, notifiedAt: createdAt, inactiveSince: null, activeCheckFailures: 0, lastCheckedAt: h(1),
      travelTimeFailures: 0, travelTimesAt: null, connectivity: null, connectivityMaxDown: null, connectivityFiber: null,
      connectivityMobileBits: null, connectivityCheckedAt: null,
      lifecycle: { state, source: state === 'new' ? null : 'user', changedAt: state === 'new' ? createdAt : createdAt + 900_000, changedBy: state === 'new' ? null : userId, appliedAt: state === 'applied' ? createdAt + 600_000 : null, viewedAt: state === 'viewed' ? createdAt + 900_000 : null },
    });
  });
  batch.set(db.collection('settings').doc(`${userId}__home_addresses`), {
    id: 'home_addresses_demo', create_date: now, name: 'home_addresses', userId,
    value: JSON.stringify([
      { id: 'work', label: 'Work', address: 'Alexanderplatz 1, 10178 Berlin', coords: { lat: 52.5219, lng: 13.4132 } },
      { id: 'gym', label: 'Gym', address: 'Bergmannstraße 5, 10961 Berlin', coords: { lat: 52.4886, lng: 13.3952 } },
    ]),
  });
  await batch.commit();
  console.log('seeded', jobs.length, 'jobs,', listings.length, 'listings');
})();
