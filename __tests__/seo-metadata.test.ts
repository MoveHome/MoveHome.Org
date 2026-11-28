import React, { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import { metadata } from '../src/app/layout';
import HomePage, { metadata as homeMetadata } from '../src/app/page';

type ElementProps = {
  children?: ReactNode;
  href?: string;
  type?: string;
  dangerouslySetInnerHTML?: { __html: string };
};

// Flatten the JSX a server component returns into host elements.
function flatten(node: ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!React.isValidElement<ElementProps>(node)) return [];
  return [node, ...flatten(node.props.children)];
}

function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!React.isValidElement<ElementProps>(node)) return '';
  return textContent(node.props.children);
}

function findElement(tree: React.ReactElement<ElementProps>[], type: string) {
  const element = tree.find((candidate) => candidate.type === type);
  if (!element) throw new Error(`<${type}> not found in rendered output`);
  return element;
}

describe('MoveHome.org SEO Metadata Bundle', () => {
  it('robots() returns rules and sitemap URL', () => {
    const res = robots();
    expect(res.sitemap).toBe('https://movehome.org/sitemap.xml');
    const rules = Array.isArray(res.rules) ? res.rules : [res.rules];
    expect(rules[0].userAgent).toBe('*');
    expect(rules[0].allow).toContain('/');
    expect(rules[0].disallow).toEqual(
      expect.arrayContaining(['/api/', '/auth/', '/oauth/', '/signin'])
    );
  });

  it('sitemap() returns correct URLs', () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    const expected = [
      'https://movehome.org',
      'https://movehome.org/registry',
      'https://movehome.org/charter',
      'https://movehome.org/about',
      'https://movehome.org/connect',
      'https://movehome.org/app',
      'https://movehome.org/search',
      'https://movehome.org/privacy',
      'https://movehome.org/terms',
    ];
    for (const url of expected) {
      expect(urls).toContain(url);
    }
  });

  it('layout metadata has metadataBase, canonical, robots, OG and Twitter', () => {
    expect(metadata.metadataBase?.toString()).toBe('https://movehome.org/');
    // No site-wide canonical: it would collapse every route onto the home page.
    expect(metadata.alternates?.canonical).toBeUndefined();
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({
      title: 'MoveHome.org — The Non-Profit Behind RAIA Protocol',
      description: 'Move Home Organisation CIC (Co. No. 17202438) is a UK Community Interest Company. Asset-locked, mission-bound.',
      siteName: 'MoveHome.org',
      type: 'website',
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary',
    });
  });

  it('canonical is set on the home page only', () => {
    expect(homeMetadata.alternates?.canonical).toBe('/');
    expect(homeMetadata.openGraph).toMatchObject({ url: '/' });
  });

  it('page.tsx embeds JSON-LD and includes brand H1 & footer links', () => {
    const tree = flatten(HomePage());

    // JSON-LD structured data
    const script = findElement(tree, 'script');
    expect(script.props.type).toBe('application/ld+json');
    const html = script.props.dangerouslySetInnerHTML?.__html;
    expect(html).toBeTruthy();
    const jsonLd = JSON.parse(html as string);
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@graph']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@type': 'Organization',
          name: 'MoveHome.org',
          legalName: 'Move Home Organisation CIC',
          identifier: '17202438',
          url: 'https://movehome.org',
          sameAs: ['https://estateaigents.org'],
        }),
        expect.objectContaining({
          '@type': 'WebSite',
          name: 'MoveHome.org',
          url: 'https://movehome.org',
        }),
      ])
    );

    // Brand keyword in the H1
    const h1 = findElement(tree, 'h1');
    expect(textContent(h1.props.children)).toContain('MoveHome.org');

    // Footer links are crawlable anchors
    const footer = findElement(tree, 'footer');
    const hrefs = flatten(footer.props.children)
      .map((element) => element.props.href)
      .filter((href): href is string => typeof href === 'string');
    for (const href of ['/about', '/charter', '/registry', '/connect', '/privacy', '/terms']) {
      expect(hrefs).toContain(href);
    }
  });
});
