/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { isOneOf } from '../../lib/utils.js';
import assert from 'assert';

describe('utils', () => {
  describe('#isOneOf()', () => {
    it('should be false', () => {
      assert.equal(isOneOf('bla', ['blub']), false);
    });
    it('should be true', () => {
      assert.equal(isOneOf('bla blub blubber', ['bla']), true);
    });
  });
});
