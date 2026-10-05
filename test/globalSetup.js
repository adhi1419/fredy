/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Vitest global setup - runs once in the main process before any workers start.
 *
 * Fredy fetches every provider over plain HTTP, so there is no browser binary to download or
 * validate before a run. The hook is kept as a no-op so the vitest config reference stays valid
 * and a future global setup step has a home.
 *
 * @returns {Promise<void>}
 */
export async function setup() {}
