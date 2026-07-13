import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OddsApiEvent } from '../src/odds-api.js';
import { normalizeEvents } from '../src/normalize.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'odds-api-soccer.json'), 'utf8'),
) as OddsApiEvent[];

describe('normalizeEvents', () => {
  it('achata eventos em uma linha por odd', () => {
    const rows = normalizeEvents(fixture);
    // pinnacle: 3 h2h + 2 totals; onexbet: 3 h2h = 8
    expect(rows).toHaveLength(8);
  });

  it('preenche campos do evento, casa e mercado', () => {
    const rows = normalizeEvents(fixture);
    const over = rows.find((r) => r.outcome === 'Over');
    expect(over).toMatchObject({
      eventId: 'e912304de2b2ce35b473ce2ecd3d1502',
      sportKey: 'soccer_epl',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      bookmaker: 'pinnacle',
      market: 'totals',
      point: 2.5,
      price: 1.95,
    });
  });

  it('usa point 0 quando o outcome não tem point (h2h)', () => {
    const rows = normalizeEvents(fixture);
    const h2h = rows.find((r) => r.market === 'h2h');
    expect(h2h?.point).toBe(0);
  });
});
