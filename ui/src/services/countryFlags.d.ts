/* Copyright (c) 2026 by Christian Kellner. */

export function labelWithFlags(provider: { name?: string; countries?: readonly string[] }): string;
export function flagFor(code?: unknown): string;
export function flagsFor(countries?: readonly string[]): string;

export {};
