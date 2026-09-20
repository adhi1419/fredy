/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { applyTheme, currentTheme, normalizeTheme, DEFAULT_THEME, THEMES } from '../../ui/src/services/theme/theme.js';

const uiSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ui/src');

/**
 * The one global theme.js touches. The suite runs without a DOM, and this double covers the whole
 * of its contact with the browser: a single attribute on the body.
 */
interface StubBrowserDocument {
  attributes: Record<string, string>;
}

/**
 * @returns
 */
function stubBrowser(): StubBrowserDocument {
  const attributes: Record<string, string> = {};
  vi.stubGlobal('document', {
    body: {
      setAttribute: (name: string, value: string) => (attributes[name] = value),
      getAttribute: (name: string) => attributes[name] ?? null,
    },
  });
  return { attributes };
}

describe('theme preference', () => {
  let browser: StubBrowserDocument;

  beforeEach(() => {
    browser = stubBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers exactly the two themes the stylesheets define a palette for', () => {
    expect(THEMES).toEqual(['dark', 'light']);
    expect(THEMES).toContain(DEFAULT_THEME);
  });

  it('falls back to the default for anything that is not a known theme', () => {
    for (const value of [undefined, null, '', 'sepia', 'DARK', 42, {}]) {
      expect(normalizeTheme(value)).toBe(DEFAULT_THEME);
    }
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
  });

  it('paints the document by setting the attribute Semi UI and themes.less both read', () => {
    expect(applyTheme('light')).toBe('light');
    expect(browser.attributes['theme-mode']).toBe('light');
    expect(currentTheme()).toBe('light');

    applyTheme('dark');
    expect(browser.attributes['theme-mode']).toBe('dark');
    expect(currentTheme()).toBe('dark');
  });

  it('never paints a theme it has no palette for', () => {
    expect(applyTheme('sepia')).toBe(DEFAULT_THEME);
    expect(browser.attributes['theme-mode']).toBe(DEFAULT_THEME);
  });

  it('is shipped on the body by index.html, so a cold load paints the default once', () => {
    const html = fs.readFileSync(path.join(uiSrc, '../../index.html'), 'utf-8');
    expect(html).toContain(`<body theme-mode="${DEFAULT_THEME}">`);
  });

  it('keeps no copy of the preference, which belongs to the settings table alone', () => {
    const source = fs.readFileSync(path.join(uiSrc, 'services/theme/theme.ts'), 'utf-8');
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe('themes.less', () => {
  const source = fs.readFileSync(path.join(uiSrc, 'themes.less'), 'utf-8');

  /**
   * The custom properties declared inside one selector block.
   *
   * @param selector
   * @returns
   */
  function tokensIn(selector: string): string[] {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} block is missing`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n}', start);
    const block = source.slice(start, end);
    return [...block.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]).sort();
  }

  /**
   * Read the custom-property values declared inside one selector block.
   *
   * @param selector
   * @returns
   */
  function valuesIn(selector: string): Record<string, string> {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} block is missing`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n}', start);
    const block = source.slice(start, end);
    return Object.fromEntries(
      [...block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()]),
    );
  }

  /**
   * Parse the solid hex colours used by the semantic foreground and background tokens.
   *
   * @param value
   * @returns
   */
  function parseHex(value: string): [number, number, number] {
    const hex = value.trim().slice(1);
    const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex;
    expect(value, `expected a hex colour, got ${value}`).toMatch(/^#[0-9a-f]{3,6}$/i);
    return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number];
  }

  /**
   * Calculate the WCAG relative luminance contrast ratio for two solid colours.
   *
   * @param foreground
   * @param background
   * @returns
   */
  function contrastRatio(foreground: string, background: string): number {
    const luminance = (value: string): number => {
      const channels = parseHex(value).map((channel) => channel / 255);
      const linear = channels.map((channel) =>
        channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  }

  const contrastRequirements: readonly [
    label: string,
    foregroundToken: string,
    backgroundToken: string,
    minimum: number,
  ][] = [
    ['body text on base', '--f-text', '--f-base', 4.5],
    ['body text on surface', '--f-text', '--f-surface', 4.5],
    ['muted text on base', '--f-muted', '--f-base', 4.5],
    ['muted text on surface', '--f-muted', '--f-surface', 4.5],
    ['accent text on base', '--f-accent', '--f-base', 4.5],
    ['accent text on surface', '--f-accent', '--f-surface', 4.5],
    ['primary button foreground on accent fill', '#ffffff', '--f-accent-fill', 4.5],
    ['selected activity pill foreground on accent fill', '--f-on-accent', '--f-accent-fill', 4.5],
    ['success text on base', '--f-success', '--f-base', 4.5],
    ['error text on base', '--f-error', '--f-base', 4.5],
    ['warning text on base', '--f-warning', '--f-base', 4.5],
    ['info text on base', '--f-info', '--f-base', 4.5],
    ['focus outline on base', '--f-accent', '--f-base', 3],
    ['selected navigation on base', '--f-accent', '--f-base', 4.5],
  ];

  it('keeps the semantic palette aliases wired to the solid-control fill', () => {
    const tokenSource = fs.readFileSync(path.join(uiSrc, 'tokens.less'), 'utf-8');
    const indexSource = fs.readFileSync(path.join(uiSrc, 'Index.less'), 'utf-8');
    expect(tokenSource).toContain('@color-accent-fill: var(--f-accent-fill);');
    expect(indexSource).toContain('--semi-color-primary: @color-accent-fill !important;');
  });

  it('keeps required light and dark semantic pairs above WCAG contrast thresholds', () => {
    for (const selector of [':root', "body[theme-mode='light']"]) {
      const values = valuesIn(selector);
      for (const [label, foregroundToken, backgroundToken, minimum] of contrastRequirements) {
        const foreground = foregroundToken.startsWith('--') ? values[foregroundToken] : foregroundToken;
        const background = values[backgroundToken];
        const ratio = contrastRatio(foreground, background);
        expect(ratio, `${selector}: ${label}`).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it('keeps non-DOM chart fallbacks synchronized with the dark theme tokens', () => {
    const chartSource = fs.readFileSync(path.join(uiSrc, 'components/cards/chartTheme.ts'), 'utf8');
    const dark = valuesIn(':root');
    for (const token of [
      '--f-accent',
      '--f-border',
      '--f-border-bright',
      '--f-muted',
      '--f-text',
      '--f-elevated',
      '--f-blue-text',
      '--f-green-text',
      '--f-purple-text',
      '--f-orange-text',
      '--f-warning',
      '--f-success',
      '--f-error',
    ]) {
      expect(chartSource, `${token} chart fallback`).toContain(`token('${token}', '${dark[token]}')`);
    }
  });

  it('defines every token in both themes', () => {
    // The failure this guards against is silent: a token added to one block only inherits whatever
    // the other theme happened to leave behind, and nothing looks wrong until someone switches.
    expect(tokensIn("body[theme-mode='light']")).toEqual(tokensIn(':root'));
  });

  it('is the only stylesheet carrying a colour literal', () => {
    const stylesheets: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.less') && entry.name !== 'themes.less') stylesheets.push(full);
      }
    };
    walk(uiSrc);

    /*
     * Colours that are not the theme's to decide, and are therefore allowed to stay literal:
     *  - scrims, and the hairlines drawn on them, where the surface underneath is a photograph and
     *    stays a photograph in both themes
     *  - `#000` used as a mask stencil, where the value is an on/off switch and not a colour
     *  - white on the dedicated forest control fill, whose contrast is asserted above
     *  - the dead `.chartCard` block, which renders nowhere (only its `__no__data` child is used)
     */
    const allowed: readonly RegExp[] = [
      /linear-gradient\(#000 0 0\)/g,
      /rgba\(0, 0, 0, [\d.]+\)/g,
      /rgba\(255, 255, 255, 0\.(12|22)\)/g,
      /color-mix\(in oklab, var\(--card-bg[^)]*\)[^;]*/g,
      /rgb\(70 72 78\)/g,
      /color: #fff;/g,
    ];

    const offenders: string[] = [];
    for (const file of stylesheets) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, index) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        const stripped = allowed.reduce((text, pattern) => text.replace(pattern, ''), line);
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(stripped)) {
          offenders.push(`${path.relative(uiSrc, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
