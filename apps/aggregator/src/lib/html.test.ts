import { describe, it, expect } from 'vitest';
import { htmlToPlainText } from './html.js';

describe('htmlToPlainText', () => {
  it('strips plain HTML tags to text', () => {
    expect(htmlToPlainText('<p>Bonjour <strong>monde</strong></p>')).toBe('Bonjour monde');
  });

  it('decodes HTML-escaped HTML before stripping (Teamtailor case)', () => {
    // "&lt;p&gt;Texte&lt;/p&gt;" must not survive as literal <p> on screen.
    const out = htmlToPlainText('&lt;p&gt;Texte&lt;/p&gt;');
    expect(out).toBe('Texte');
    expect(out).not.toContain('<');
    expect(out).not.toContain('&lt;');
  });

  it('turns list items into bullet lines', () => {
    const out = htmlToPlainText('<ul><li>Un</li><li>Deux</li></ul>');
    expect(out).toContain('Un');
    expect(out).toContain('Deux');
  });

  it('decodes numeric and named entities', () => {
    expect(htmlToPlainText('Prix : 10 &amp; plus')).toContain('&');
    expect(htmlToPlainText('R&#233;mun&#233;ration')).toBe('Rémunération');
    // A non-breaking space entity collapses to a normal space.
    expect(htmlToPlainText('a&#xa0;b')).toBe('a b');
  });

  it('returns undefined for non-strings and empty input', () => {
    expect(htmlToPlainText(undefined)).toBeUndefined();
    expect(htmlToPlainText(null)).toBeUndefined();
    expect(htmlToPlainText(123)).toBeUndefined();
    expect(htmlToPlainText('   ')).toBeUndefined();
  });

  it('leaves already-clean text intact', () => {
    expect(htmlToPlainText('Conseiller de vente en CDI, 35h.')).toBe('Conseiller de vente en CDI, 35h.');
  });
});
