/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { canUseChannel, canEditChannel, canListChannel } from '../../lib/services/security/channelAccess.js';

const owner = { id: 'u1', isAdmin: false };
const stranger = { id: 'u2', isAdmin: false };
const admin = { id: 'a1', isAdmin: true };
const channel = (visibility) => ({ id: 'c1', userId: 'u1', visibility });

describe('canUseChannel', () => {
  it('lets the owner use their own private channel', () => {
    expect(canUseChannel(owner, channel('private'))).toBe(true);
  });

  it('hides a private channel from everybody else', () => {
    expect(canUseChannel(stranger, channel('private'))).toBe(false);
  });

  it('lets an admin use anything', () => {
    expect(canUseChannel(admin, channel('private'))).toBe(true);
  });

  it('lets any user use an everyone channel', () => {
    expect(canUseChannel(stranger, channel('everyone'))).toBe(true);
  });

  it('keeps an admin channel away from a normal user', () => {
    expect(canUseChannel(stranger, channel('admin'))).toBe(false);
    expect(canUseChannel(admin, channel('admin'))).toBe(true);
  });

  it('says no for a missing user or channel', () => {
    expect(canUseChannel(null, channel('everyone'))).toBe(false);
    expect(canUseChannel(owner, null)).toBe(false);
  });

  it('denies access when both user.id and channel.userId are absent', () => {
    expect(canUseChannel({ isAdmin: false }, { visibility: 'private' })).toBe(false);
  });

  it('denies access when user.id is absent even if channel.userId exists', () => {
    expect(canUseChannel({ isAdmin: false }, { userId: 'u1', visibility: 'private' })).toBe(false);
  });

  it('denies access when channel.userId is absent even if user.id exists', () => {
    expect(canUseChannel({ id: 'u1', isAdmin: false }, { visibility: 'private' })).toBe(false);
  });

  it('allows everyone visibility even with missing ids', () => {
    expect(canUseChannel({ isAdmin: false }, { visibility: 'everyone' })).toBe(true);
  });

  it('always allows admins regardless of missing ids', () => {
    expect(canUseChannel({ isAdmin: true }, { visibility: 'private' })).toBe(true);
  });
});

describe('canListChannel', () => {
  it('lets the owner see their own private channel', () => {
    expect(canListChannel(owner, channel('private'))).toBe(true);
  });

  it('hides a private channel from a stranger', () => {
    expect(canListChannel(stranger, channel('private'))).toBe(false);
  });

  it('does not let admin status alone reveal another user private channel', () => {
    // The tenant-isolation fix: being an admin is not visibility into someone else's private data.
    expect(canListChannel(admin, channel('private'))).toBe(false);
  });

  it('lets any user see an everyone channel', () => {
    expect(canListChannel(stranger, channel('everyone'))).toBe(true);
    expect(canListChannel(admin, channel('everyone'))).toBe(true);
  });

  it('shows an admin-visibility channel to admins only', () => {
    expect(canListChannel(admin, channel('admin'))).toBe(true);
    expect(canListChannel(stranger, channel('admin'))).toBe(false);
  });

  it('lets an admin see an admin-visibility channel they do not own', () => {
    expect(canListChannel(admin, { id: 'c1', userId: 'someone-else', visibility: 'admin' })).toBe(true);
  });

  it('says no for a missing user or channel', () => {
    expect(canListChannel(null, channel('everyone'))).toBe(false);
    expect(canListChannel(owner, null)).toBe(false);
  });

  it('denies when both user.id and channel.userId are absent', () => {
    expect(canListChannel({ isAdmin: false }, { visibility: 'private' })).toBe(false);
  });

  it('denies a private channel when user.id is absent even if channel.userId exists', () => {
    expect(canListChannel({ isAdmin: false }, { userId: 'u1', visibility: 'private' })).toBe(false);
  });

  it('allows everyone visibility even with missing ids', () => {
    expect(canListChannel({ isAdmin: false }, { visibility: 'everyone' })).toBe(true);
  });

  it('does not treat an admin-visibility channel as owned by an id-less user', () => {
    // A caller without an id must not match on ownership; admin flag still gates the admin share.
    expect(canListChannel({ isAdmin: true }, { visibility: 'admin' })).toBe(true);
    expect(canListChannel({ isAdmin: false }, { visibility: 'admin' })).toBe(false);
  });
});

describe('canEditChannel', () => {
  it('is owner-only - sharing and administrator status do not transfer ownership', () => {
    expect(canEditChannel(owner, channel('everyone'))).toBe(true);
    expect(canEditChannel(admin, channel('private'))).toBe(false);
    expect(canEditChannel(admin, channel('admin'))).toBe(false);
    expect(canEditChannel(stranger, channel('everyone'))).toBe(false);
  });

  it('denies edit when either identity is absent', () => {
    expect(canEditChannel({ isAdmin: false }, { visibility: 'private' })).toBe(false);
    expect(canEditChannel({ isAdmin: false }, { userId: 'u1' })).toBe(false);
    expect(canEditChannel({ id: 'u1', isAdmin: false }, {})).toBe(false);
    expect(canEditChannel({ isAdmin: true }, {})).toBe(false);
  });
});
