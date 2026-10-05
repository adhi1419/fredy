/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import { getSettings } from '../services/storage/settingsStorage.js';
import logger from '../services/logger.js';
import { authHook } from './security.js';
import { registerHttpSupport } from './http.js';

import authPlugin from './routes/firebaseLoginRoute.js';
import triggerPlugin from './routes/triggerRoute.js';
import jobPlugin from './routes/jobRouter.js';
import listingsPlugin from './routes/listingsRouter.js';
import dashboardPlugin from './routes/dashboardRouter.js';
import financePlugin from './routes/financeRouter.js';
import userSettingsPlugin from './routes/userSettingsRoute.js';
import transitPlugin from './routes/transitRoute.js';
import generalSettingsPlugin from './routes/generalSettingsRoute.js';
import notificationAdapterPlugin from './routes/notificationAdapterRouter.js';
import notificationChannelPlugin from './routes/notificationChannelRouter.js';
import providerPlugin from './routes/providerRouter.js';

const settings = await getSettings();
// Cloud Run (and most PaaS) inject PORT; it wins over the stored setting.
const PORT = Number(process.env.PORT) || settings.port || 9998;

const fastify = Fastify({
  logger: false,
  bodyLimit: 50 * 1024 * 1024, // 50 MB
  // Fredy is nearly always deployed behind a reverse proxy (Docker + nginx/Traefik), where the
  // socket address is the proxy's. With this, `request.ip` follows X-Forwarded-For, which is what
  // the trigger route and other rate limiters count against.
  trustProxy: settings.trustProxy ?? true,
});

// Security headers (CSP disabled to avoid breaking the SPA)
await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: false,
  // Helmet's default COOP (same-origin) severs window.opener between the app
  // and the Firebase sign-in popup, so signInWithPopup sees the popup as
  // closed and auth silently fails. same-origin-allow-popups keeps the
  // opener link for popups we open while retaining COOP protection.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
});

registerHttpSupport(fastify);

// Public routes - no auth required. Firebase is the only browser auth authority;
// its web configuration is public, while /api/auth/me is protected by its route hook.
fastify.register(authPlugin, { prefix: '/api/auth' });
// Machine-to-machine trigger (token-authenticated in the route itself; 404 when unconfigured)
fastify.register(triggerPlugin, { prefix: '/api/trigger' });

// User-authenticated routes
fastify.register(async (app) => {
  app.addHook('preHandler', authHook);
  app.register(jobPlugin, { prefix: '/api/jobs' });
  app.register(notificationAdapterPlugin, { prefix: '/api/jobs/notificationAdapter' });
  app.register(notificationChannelPlugin, { prefix: '/api/notificationChannels' });
  app.register(providerPlugin, { prefix: '/api/jobs/provider' });
  app.register(listingsPlugin, { prefix: '/api/listings' });
  app.register(dashboardPlugin, { prefix: '/api/dashboard' });
  app.register(financePlugin, { prefix: '/api/finance' });
  app.register(userSettingsPlugin, { prefix: '/api/user/settings' });
  app.register(transitPlugin, { prefix: '/api/transit' });
  app.register(generalSettingsPlugin, { prefix: '/api/admin/generalSettings' });
});

// API-only server: unknown paths return JSON instead of serving frontend content.
fastify.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));

await fastify.listen({ port: PORT, host: '0.0.0.0' });
logger.debug(`Started API service on port ${PORT}`);
