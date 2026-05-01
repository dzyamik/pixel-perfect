/**
 * Recipes index — aggregates `@snippet` markers across every
 * annotated demo into a single searchable list.
 *
 * Each demo's source is imported via Vite's `?raw` suffix at build
 * time, so the recipes page stays in sync with the demos with
 * zero manual upkeep — adding new snippet markers in any demo's
 * `main.ts` automatically surfaces them here.
 */

import { parseSnippets, renderCard } from '../_shared/code-panel.js';

import demo02Source from '../02-click-to-carve/main.ts?raw';
import demo03Source from '../03-physics/main.ts?raw';
import demo04Source from '../04-falling-debris/main.ts?raw';
import demo06Source from '../06-worms-style/main.ts?raw';
import demo07Source from '../07-image-terrain/main.ts?raw';
import demo08Source from '../08-sprite-playground/main.ts?raw';
import demo09Source from '../09-falling-sand/main.ts?raw';

interface DemoEntry {
    slug: string;
    title: string;
    blurb: string;
    source: string;
}

const demos: readonly DemoEntry[] = [
    {
        slug: '02-click-to-carve',
        title: '02 — click to carve',
        blurb: 'Pointer input on top of destructible terrain.',
        source: demo02Source,
    },
    {
        slug: '03-physics',
        title: '03 — physics colliders',
        blurb: 'Box2D wired to destructible terrain.',
        source: demo03Source,
    },
    {
        slug: '04-falling-debris',
        title: '04 — falling debris',
        blurb: 'Carve detaches islands as dynamic bodies.',
        source: demo04Source,
    },
    {
        slug: '06-worms-style',
        title: '06 — worms-style',
        blurb: 'Character controller + grenades + crater explosions.',
        source: demo06Source,
    },
    {
        slug: '07-image-terrain',
        title: '07 — image-based terrain',
        blurb: 'Stamp PNG / canvas masks onto the bitmap.',
        source: demo07Source,
    },
    {
        slug: '08-sprite-playground',
        title: '08 — sprite playground',
        blurb: 'Pixel-perfect overlap + alpha outlines.',
        source: demo08Source,
    },
    {
        slug: '09-falling-sand',
        title: '09 — falling sand sandbox',
        blurb: 'Five fluids + density swaps + fire.',
        source: demo09Source,
    },
];

const host = document.getElementById('recipes-host')!;
const search = document.getElementById('search') as HTMLInputElement;

interface MountedCard {
    section: HTMLElement;
    card: HTMLElement;
    haystack: string;
}

const mounted: MountedCard[] = [];

for (const demo of demos) {
    const snippets = parseSnippets(demo.source);
    if (snippets.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'demo-section';

    const h2 = document.createElement('h2');
    const link = document.createElement('a');
    link.href = `../${demo.slug}/`;
    link.textContent = demo.title;
    h2.append(link);

    const blurb = document.createElement('p');
    blurb.className = 'demo-blurb';
    blurb.textContent = `${demo.blurb} (${snippets.length} snippet${snippets.length === 1 ? '' : 's'})`;

    section.append(h2, blurb);

    for (const s of snippets) {
        const card = renderCard(s);
        section.append(card);
        mounted.push({
            section,
            card,
            haystack: `${s.slug} ${s.title} ${s.description} ${s.code}`.toLowerCase(),
        });
    }

    host.append(section);
}

search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (q === '') {
        for (const m of mounted) {
            m.card.style.display = '';
            m.section.style.display = '';
        }
        return;
    }
    // Hide cards that don't match; hide sections that have no
    // visible cards.
    const visiblePerSection = new Map<HTMLElement, number>();
    for (const m of mounted) {
        const match = m.haystack.includes(q);
        m.card.style.display = match ? '' : 'none';
        if (match) {
            visiblePerSection.set(
                m.section,
                (visiblePerSection.get(m.section) ?? 0) + 1,
            );
        }
    }
    const seen = new Set<HTMLElement>();
    for (const m of mounted) {
        if (seen.has(m.section)) continue;
        seen.add(m.section);
        m.section.style.display = (visiblePerSection.get(m.section) ?? 0) > 0 ? '' : 'none';
    }
});
