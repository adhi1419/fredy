/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let directory = null;

afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = null;
});

describe('copyright tool', () => {
  it('keeps a JavaScript shebang on the first line', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fredy-copyright-'));
    const fixture = path.join(directory, 'command.js');
    await fs.writeFile(fixture, '#!/usr/bin/env node\nconsole.log("hello");\n');

    await execute(process.execPath, [path.resolve('copyright.js'), fixture]);

    const result = await fs.readFile(fixture, 'utf8');
    expect(result).toMatch(/^#!\/usr\/bin\/env node\n\/\*/);
    expect(result.match(/Copyright \(c\)/g)).toHaveLength(1);
    expect(result).toContain('console.log("hello");');
  });
});
