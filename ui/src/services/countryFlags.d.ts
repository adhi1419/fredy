/* Copyright (c) 2026 by Christian Kellner. */

export function labelWithFlags(provider: { name?: string; countries?: readonly string[] }): string;
export function flagFor(code: string): string;
export function flagsFor(countries?: readonly string[]): string;

export {};
