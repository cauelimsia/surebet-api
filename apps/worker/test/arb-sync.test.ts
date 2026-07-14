import { describe, expect, it } from 'vitest';
import type { Arb } from '@surebet/core';
import { planArbSync } from '../src/arb-sync.js';

function makeArb(arbKey: string): Arb {
  return {
    arbKey,
    eventId: arbKey.split('|')[0],
    market: 'totals',
    point: 2.5,
    profitPct: 3.5,
    legs: [
      { bookmaker: 'bookA', outcome: 'Over', price: 2.1, point: 2.5 },
      { bookmaker: 'bookB', outcome: 'Under', price: 2.1, point: 2.5 },
    ],
  };
}

describe('planArbSync', () => {
  it('arb novo vira insert', () => {
    const plan = planArbSync([makeArb('ev1|totals|2.5')], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.goneIds).toHaveLength(0);
  });

  it('arb já ativo vira update com o id existente', () => {
    const plan = planArbSync(
      [makeArb('ev1|totals|2.5')],
      [{ id: 'row-1', arbKey: 'ev1|totals|2.5' }],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: 'row-1', arb: makeArb('ev1|totals|2.5') }]);
    expect(plan.goneIds).toHaveLength(0);
  });

  it('arb ativo que sumiu vira gone', () => {
    const plan = planArbSync([], [{ id: 'row-1', arbKey: 'ev1|totals|2.5' }]);
    expect(plan.goneIds).toEqual(['row-1']);
  });

  it('mistura: 1 novo, 1 refresh, 1 gone', () => {
    const plan = planArbSync(
      [makeArb('ev1|totals|2.5'), makeArb('ev2|h2h|0')],
      [
        { id: 'row-1', arbKey: 'ev1|totals|2.5' },
        { id: 'row-2', arbKey: 'ev3|spreads|1.5' },
      ],
    );
    expect(plan.inserts.map((a) => a.arbKey)).toEqual(['ev2|h2h|0']);
    expect(plan.updates.map((u) => u.id)).toEqual(['row-1']);
    expect(plan.goneIds).toEqual(['row-2']);
  });
});
