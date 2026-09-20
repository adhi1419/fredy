/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Lightweight dev mock server on port 9998.
 * Vite proxies /api to this. Run with: node tools/devMock.js
 */

import http from 'node:http';
const now = Date.now();

const users = [{ id: 1, username: 'admin', isAdmin: true, lastLogin: now, numberOfJobs: 4 }];

const jobs = [
  {
    id: 'job1',
    name: 'Munich Apartments',
    enabled: true,
    running: false,
    blacklist: [],
    provider: [
      {
        id: 'immoscout',
        name: 'ImmobilienScout24',
        url: 'https://www.immobilienscout24.de/Suche/S-T/Wohnung-Miete/Bayern/Muenchen',
      },
    ],
    notificationAdapter: [],
    specFilter: { maxPrice: 1500, minSize: 50 },
    numberOfFoundListings: 2,
    isOnlyShared: false,
  },
  {
    id: 'job2',
    name: 'Berlin Rentals',
    enabled: false,
    running: false,
    blacklist: ['keller', 'EG'],
    provider: [{ id: 'immo', name: 'Immowelt', url: 'https://www.immowelt.de/suche/berlin/wohnungen/mieten' }],
    notificationAdapter: [],
    specFilter: {},
    numberOfFoundListings: 2,
    isOnlyShared: false,
  },
  {
    id: 'job3',
    name: 'Running Search',
    enabled: true,
    running: true,
    blacklist: [],
    provider: [{ id: 'immo', name: 'Immowelt', url: 'https://www.immowelt.de/suche/hamburg/wohnungen/mieten' }],
    notificationAdapter: [],
    specFilter: {},
    numberOfFoundListings: 1,
    isOnlyShared: false,
  },
  {
    id: 'job4',
    name: 'Partner Search',
    enabled: true,
    running: false,
    blacklist: [],
    provider: [{ id: 'metadataOnly', name: 'Metadata-only provider', url: 'https://example.com/search' }],
    notificationAdapter: [],
    specFilter: {},
    numberOfFoundListings: 4,
    isOnlyShared: true,
  },
];

const listings = [
  {
    id: 'l1',
    title: '3-Zimmer-Wohnung in Schwabing',
    price: 1350,
    address: 'Leopoldstr. 42, München',
    provider: 'ImmobilienScout24',
    createdAt: now - 3600000,
    created_at: now - 3600000,
    image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=60',
    link: 'https://example.com/l1',
    is_active: true,
    isWatched: 0,
    jobId: 'job1',
    job_name: 'Munich Apartments',
    size: 72,
    rooms: 3,
    description: 'Schöne 3-Zimmer-Wohnung in bester Lage in Schwabing. Balkon, Parkett, moderne Küche.',
    latitude: 48.1598,
    longitude: 11.5876,
    lifecycle: { state: 'applied' },
    travelTimes: [
      {
        label: 'Work',
        mode: 'transit',
        transit: { minutes: 18, transfers: 1 },
        car: { minutes: 12, distanceMeters: 3800 },
      },
    ],
  },
  {
    id: 'l2',
    title: 'Helle 2-Zimmer near Ostbahnhof',
    price: 980,
    address: 'Rosenheimer Str. 15, München',
    provider: 'ImmobilienScout24',
    createdAt: now - 7200000,
    created_at: now - 7200000,
    image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=60',
    link: 'https://example.com/l2',
    is_active: true,
    isWatched: 1,
    jobId: 'job1',
    job_name: 'Munich Apartments',
    size: 55,
    rooms: 2,
    description: 'Helle 2-Zimmer-Wohnung nahe Ostbahnhof. Ruhige Lage, gute Anbindung.',
    latitude: 48.1285,
    longitude: 11.6005,
    lifecycle: { state: 'viewed' },
    travelTimes: [
      {
        label: 'Work',
        mode: 'transit',
        transit: { minutes: 19, transfers: 0 },
        car: { minutes: 15, distanceMeters: 5100 },
      },
    ],
  },
  {
    id: 'l3',
    title: 'Altbau in Prenzlauer Berg',
    price: 1100,
    address: 'Kastanienallee 28, Berlin',
    provider: 'Immowelt',
    createdAt: now - 86400000,
    created_at: now - 86400000,
    image_url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=60',
    link: 'https://example.com/l3',
    is_active: false,
    isWatched: 0,
    jobId: 'job2',
    job_name: 'Berlin Rentals',
    size: 65,
    rooms: 2,
    description: 'Charmante Altbauwohnung in Prenzlauer Berg. Hohe Decken, Stuck, Holzdielen.',
    latitude: 52.5397,
    longitude: 13.4098,
    lifecycle: { state: 'new' },
    travelTimes: [
      {
        label: 'Work',
        mode: 'transit',
        transit: { minutes: 24, transfers: 1 },
        car: { minutes: 21, distanceMeters: 6400 },
      },
    ],
  },
  {
    id: 'l4',
    title: '4-Zimmer Neubau Mitte',
    price: 2200,
    address: 'Karl-Liebknecht-Str. 5, Berlin',
    provider: 'Immowelt',
    createdAt: now - 172800000,
    created_at: now - 172800000,
    image_url: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1200&q=60',
    link: 'https://example.com/l4',
    is_active: true,
    isWatched: 1,
    jobId: 'job2',
    job_name: 'Berlin Rentals',
    size: 95,
    rooms: 4,
    description: 'Moderner Neubau im Herzen von Berlin Mitte. Fußbodenheizung, Aufzug, Tiefgarage.',
    latitude: 52.5219,
    longitude: 13.4132,
    lifecycle: { state: 'new' },
    travelTimes: [
      {
        label: 'Work',
        mode: 'transit',
        transit: { minutes: 9, transfers: 0 },
        car: { minutes: 7, distanceMeters: 1900 },
      },
    ],
  },
];

const notificationAdapterMetadata = [
  {
    id: 'browser',
    name: 'Browser Notifications',
    description: 'Displays native desktop push notifications directly in your browser.',
    config: {},
  },
];
const notificationChannels = [{ id: 'channel-1', name: 'Browser notifications', adapterId: 'browser' }];

const providerMetadata = [
  {
    id: 'immoscout',
    name: 'ImmobilienScout24',
    baseUrl: 'https://www.immobilienscout24.de/',
    countries: ['de'],
    capabilities: {
      application: {
        manual: true,
        automatic: true,
        validation: 'provider',
        profileRequirements: ['identity', 'contact', 'address', 'household', 'employment', 'income', 'move-in'],
        consentRequirements: ['provider-privacy'],
        connectionRequired: false,
        eligibility: 'provider',
      },
    },
  },
  { id: 'immo', name: 'Immowelt', baseUrl: 'https://www.immowelt.de' },
  { id: 'metadataOnly', name: 'Metadata-only provider', baseUrl: 'https://example.com/metadata-only' },
];
const providerIdsByName = new Map(providerMetadata.map(({ id, name }) => [name, id]));
const availableProviders = [
  ...new Set(listings.map((listing) => providerIdsByName.get(listing.provider)).filter(Boolean)),
];

const dashboard = {
  general: { interval: 30, lastRun: now - 1800000, nextRun: now + 1800000 },
  kpis: { totalJobs: 2, totalListings: 4, numberOfActiveListings: 3, medianPriceOfListings: 1225 },
  pie: [
    { type: 'ImmobilienScout24', value: 50 },
    { type: 'Immowelt', value: 50 },
  ],
};

const routes = {
  'GET /api/auth/config': { enabled: false },
  'GET /api/auth/me': { userId: 1, username: 'admin@example.com', isAdmin: true },
  'GET /api/jobs/provider': providerMetadata,
  'GET /api/jobs': jobs,
  'GET /api/jobs/shareableUserList': [],
  'GET /api/jobs/notificationAdapter': notificationAdapterMetadata,
  'GET /api/notificationChannels': notificationChannels,
  'GET /api/admin/generalSettings': { demoMode: false, interval: 30 },
  'GET /api/user/settings': {
    language: 'en',
    theme: 'light',
    inquiry_profile: {
      name: 'Alex Example',
      street: 'Main Street',
      houseNumber: '1',
      postcode: '10115',
      city: 'Berlin',
    },
  },
  'GET /api/dashboard': dashboard,
  'GET /api/demo': { demoMode: false },
  'POST /api/user/settings/listing-deletion-preference': {},
};

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, value) {
  res.writeHead(status);
  res.end(JSON.stringify(value));
}

export function createDevMockServer({ port = 9998 } = {}) {
  const mockJobs = structuredClone(jobs);
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || 'http://localhost:5175';
    const path = req.url.split('?')[0];
    const key = req.method + ' ' + path;

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (path === '/api/jobs/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const interval = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => clearInterval(interval));
      return;
    }

    res.setHeader('Content-Type', 'application/json');

    const statusMatch = path.match(/^\/api\/jobs\/([^/]+)\/status$/);
    if (req.method === 'PUT' && statusMatch) {
      const body = await readJson(req);
      const job = mockJobs.find((candidate) => candidate.id === statusMatch[1]);
      if (!job || job.isOnlyShared) {
        sendJson(res, job ? 403 : 404, { message: job ? 'Shared search is read-only' : 'Not found' });
        return;
      }
      job.enabled = body.status === true;
      sendJson(res, 200, job);
      return;
    }

    const runMatch = path.match(/^\/api\/jobs\/([^/]+)\/run$/);
    if (req.method === 'POST' && runMatch) {
      const job = mockJobs.find((candidate) => candidate.id === runMatch[1]);
      if (!job || job.isOnlyShared) {
        sendJson(res, job ? 403 : 404, { message: job ? 'Shared search is read-only' : 'Not found' });
        return;
      }
      if (job.running) {
        sendJson(res, 409, { message: 'Job is already running' });
        return;
      }
      job.running = true;
      sendJson(res, 202, job);
      return;
    }

    const userMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
    if (req.method === 'GET' && userMatch) {
      const user = users.find((u) => u.id === parseInt(userMatch[1]));
      res.writeHead(user ? 200 : 404);
      res.end(JSON.stringify(user || { message: 'Not found' }));
      return;
    }

    const listingMatch = path.match(/^\/api\/listings\/([^/]+)$/);
    if (
      req.method === 'GET' &&
      listingMatch &&
      !path.includes('/table') &&
      !path.includes('/map') &&
      !path.includes('/watch')
    ) {
      const listing = listings.find((l) => l.id === listingMatch[1]);
      res.writeHead(listing ? 200 : 404);
      res.end(JSON.stringify(listing || { message: 'Not found' }));
      return;
    }

    if (path.startsWith('/api/jobs/data') || path.startsWith('/api/jobs/table')) {
      res.writeHead(200);
      res.end(JSON.stringify({ result: mockJobs, totalNumber: mockJobs.length, page: 1 }));
      return;
    }
    if (path.startsWith('/api/listings/table')) {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          result: listings,
          totalNumber: listings.length,
          page: 1,
          availableProviders,
        }),
      );
      return;
    }
    if (path.startsWith('/api/listings/map')) {
      res.writeHead(200);
      res.end(JSON.stringify({ listings: listings.filter((l) => l.is_active), maxPrice: 2200 }));
      return;
    }

    const data = key === 'GET /api/jobs' ? mockJobs : routes[key];
    sendJson(res, 200, data !== undefined ? data : {});
  });
  server.listen(port, () => console.warn(`Dev mock ready on :${port}`));
  return server;
}

if (process.argv[1]?.endsWith('/tools/devMock.js')) {
  createDevMockServer();
}
