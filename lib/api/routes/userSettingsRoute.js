/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getSettings, getUserSettings, upsertSettings } from '../../services/storage/settingsStorage.js';
import { isAdmin } from '../security.js';
import { geocodeAddress } from '../../services/geocoding/geoCodingService.js';
import { autocompleteAddress } from '../../services/geocoding/autocompleteService.js';
import logger from '../../services/logger.js';
import { mergeSection, stripSection } from '../../services/finance/profileSections.js';
import { sanitizeInquiryProfile } from '../../services/inquiries/profile.js';
import {
  getCountriesForLookup,
  HomeAddressValidationError,
  saveHomeAddresses,
} from '../../services/userSettings/homeAddressSettings.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */

export default async function userSettingsPlugin(fastify) {
  fastify.get('/', async (request) => {
    const userId = request.currentUser.id;
    return await getUserSettings(userId);
  });

  fastify.get('/autocomplete', async (request, reply) => {
    const { q } = request.query;
    try {
      const results = await autocompleteAddress(
        q,
        await getCountriesForLookup({ userId: request.currentUser.id, providers: request.query?.providers }),
      );
      return results;
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Resolve an address to coordinates, so the map in the job form can jump to a place the user
   * names instead of making them pan across the country to find it.
   *
   * Separate from `/autocomplete`, which answers with display names only: the suggestions are
   * for choosing, this is for locating, and only the chosen one needs to cost a geocode.
   */
  fastify.get('/geocode', async (request, reply) => {
    const { q } = request.query;
    if (typeof q !== 'string' || q.trim().length === 0) {
      return reply.code(400).send({ error: 'A query is required.' });
    }
    try {
      const coordinates = await geocodeAddress(
        q.trim(),
        await getCountriesForLookup({ userId: request.currentUser.id, providers: request.query?.providers }),
      );
      // Nominatim reports "looked, found nothing" as -1/-1, which is a successful lookup with an
      // empty answer rather than a failure. The UI needs to tell those apart to say something
      // useful, so it comes back as 404 rather than coordinates in the Atlantic.
      if (coordinates == null || coordinates.lat === -1 || coordinates.lng === -1) {
        return reply.code(404).send({ error: 'No coordinates found for that address.' });
      }
      return coordinates;
    } catch (error) {
      logger.error('Error while geocoding an address for the map', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/home-address', async (request, reply) => {
    const userId = request.currentUser.id;
    const { home_addresses } = request.body;
    const settings = await getSettings();

    if (settings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change the addresses.' });
    }

    if (home_addresses != null && !Array.isArray(home_addresses)) {
      return reply.code(400).send({ error: 'home_addresses must be an array.' });
    }

    try {
      const homeAddresses = await saveHomeAddresses({ userId, homeAddresses: home_addresses });
      return { success: true, home_addresses: homeAddresses };
    } catch (error) {
      if (error instanceof HomeAddressValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      logger.error('Error updating addresses settings', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/provider-details', async (request, reply) => {
    const userId = request.currentUser.id;
    const { provider_details } = request.body;

    const globalSettings = await getSettings();
    if (globalSettings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change settings.' });
    }

    if (!Array.isArray(provider_details)) {
      return reply.code(400).send({ error: 'provider_details must be an array of provider ids.' });
    }

    try {
      await upsertSettings({ provider_details }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating provider details setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/blacklist-filter-on-details', async (request, reply) => {
    const userId = request.currentUser.id;
    const { blacklist_filter_on_provider_details } = request.body;

    const globalSettings = await getSettings();
    if (globalSettings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change settings.' });
    }

    if (typeof blacklist_filter_on_provider_details !== 'boolean') {
      return reply.code(400).send({ error: 'blacklist_filter_on_provider_details must be a boolean.' });
    }

    try {
      await upsertSettings({ blacklist_filter_on_provider_details }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating blacklist-filter-on-details setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Whether hovering a public transport stop on the map opens its departure board.
   *
   * Off unless stored, which is why there is no migration: an absent setting reads as false. The
   * board used to open on hover for everyone, and it got in the way of panning across a city with
   * stops all over it.
   */
  fastify.post('/transit-hover-popups', async (request, reply) => {
    const userId = request.currentUser.id;
    const { transit_hover_popups } = request.body || {};

    const globalSettings = await getSettings();
    if (globalSettings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change settings.' });
    }

    if (typeof transit_hover_popups !== 'boolean') {
      return reply.code(400).send({ error: 'transit_hover_popups must be a boolean.' });
    }

    try {
      await upsertSettings({ transit_hover_popups }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating the transit hover popups setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/listings-view-mode', async (request, reply) => {
    const userId = request.currentUser.id;
    const { listings_view_mode } = request.body;

    if (listings_view_mode !== 'grid' && listings_view_mode !== 'table') {
      return reply.code(400).send({ error: 'listings_view_mode must be "grid" or "table".' });
    }

    try {
      await upsertSettings({ listings_view_mode }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating listings view mode setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/jobs-view-mode', async (request, reply) => {
    const userId = request.currentUser.id;
    const { jobs_view_mode } = request.body;

    if (jobs_view_mode !== 'grid' && jobs_view_mode !== 'table') {
      return reply.code(400).send({ error: 'jobs_view_mode must be "grid" or "table".' });
    }

    try {
      await upsertSettings({ jobs_view_mode }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating jobs view mode setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/listing-deletion-preference', async (request, reply) => {
    const userId = request.currentUser.id;
    const { listing_deletion_preference } = request.body;

    const globalSettings = await getSettings();
    if (globalSettings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change settings.' });
    }

    if (listing_deletion_preference == null) {
      return reply.code(400).send({ error: 'listing_deletion_preference is required.' });
    }

    const { skipPrompt, hardDelete } = listing_deletion_preference;

    try {
      await upsertSettings({ listing_deletion_preference: { skipPrompt, hardDelete } }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating listing deletion preference', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/finance-profile', async (request, reply) => {
    const userId = request.currentUser.id;
    const { finance_profile } = request.body;

    const globalSettings = await getSettings();
    if (globalSettings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change settings.' });
    }

    // Passing null is how the user clears their profile, which also hides every
    // finance surface again (the affordability filter, the chips, the detail card).
    if (finance_profile !== null && (typeof finance_profile !== 'object' || Array.isArray(finance_profile))) {
      return reply.code(400).send({ error: 'finance_profile must be an object or null.' });
    }

    try {
      await upsertSettings({ finance_profile }, userId);
      return { success: true, finance_profile };
    } catch (error) {
      logger.error('Error updating finance profile', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Save or clear one tab (renting or buying) of the finance profile.
   *
   * The merge happens here rather than in the browser: the store used to read the currently
   * stored profile out of its own state and merge client-side, which meant a second copy of the
   * merge rules and a lost-update window between two tabs. The server merges against what is
   * actually stored.
   *
   * Body: `{ section: 'rent'|'buy', profile: Object }` to save, or `{ section, remove: true }`
   * to drop that tab while keeping the household and the other tab.
   */
  fastify.post('/finance-profile/section', async (request, reply) => {
    const userId = request.currentUser.id;
    const { section, profile, remove = false } = request.body || {};

    const globalSettings = await getSettings();
    if (globalSettings.demoMode && !isAdmin(request)) {
      return reply.code(403).send({ error: 'In demo mode, it is not allowed to change settings.' });
    }
    if (section !== 'rent' && section !== 'buy') {
      return reply.code(400).send({ error: 'section must be "rent" or "buy".' });
    }
    if (!remove && (profile == null || typeof profile !== 'object' || Array.isArray(profile))) {
      return reply.code(400).send({ error: 'profile must be an object when saving a section.' });
    }

    try {
      const stored = (await getUserSettings(userId))?.finance_profile ?? null;
      const next = remove ? stripSection(stored, section) : mergeSection(stored, section, profile);
      await upsertSettings({ finance_profile: next }, userId);
      return { success: true, finance_profile: next };
    } catch (error) {
      logger.error('Error updating a finance profile section', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Which of the two themes the interface is painted in.
   *
   * A closed set rather than free text: the value ends up on `<body theme-mode>`, and the only
   * two the stylesheets define a palette for are the two named here.
   */
  fastify.post('/theme', async (request, reply) => {
    const userId = request.currentUser.id;
    const { theme } = request.body;

    if (theme !== 'dark' && theme !== 'light') {
      return reply.code(400).send({ error: "theme must be either 'dark' or 'light'." });
    }

    try {
      await upsertSettings({ theme }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating theme setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/inquiry-profile', async (request, reply) => {
    const userId = request.currentUser.id;
    const { inquiry_profile } = request.body;

    if (inquiry_profile == null || typeof inquiry_profile !== 'object') {
      return reply.code(400).send({ error: 'inquiry_profile must be an object.' });
    }

    const sanitizedProfile = sanitizeInquiryProfile(inquiry_profile);
    try {
      await upsertSettings({ inquiry_profile: sanitizedProfile }, userId);
      return { success: true, inquiry_profile: sanitizedProfile };
    } catch (error) {
      logger.error('Error updating inquiry profile setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/language', async (request, reply) => {
    const userId = request.currentUser.id;
    const { language } = request.body;

    if (typeof language !== 'string' || language.trim() === '') {
      return reply.code(400).send({ error: 'language must be a non-empty string.' });
    }

    try {
      await upsertSettings({ language }, userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating language setting', error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
