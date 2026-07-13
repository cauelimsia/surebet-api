import type { Arb, ArbLeg, NormalizedOdd } from './types.js';

function lineKey(market: string, point: number): number {
  return market === 'spreads' ? Math.abs(point) : point;
}

export function computeArbs(odds: NormalizedOdd[]): Arb[] {
  const groups = new Map<string, NormalizedOdd[]>();
  for (const odd of odds) {
    const key = `${odd.eventId}|${odd.market}|${lineKey(odd.market, odd.point)}`;
    const list = groups.get(key) ?? [];
    list.push(odd);
    groups.set(key, list);
  }

  const arbs: Arb[] = [];
  for (const [key, group] of groups) {
    const arb = detectArb(key, group);
    if (arb) arbs.push(arb);
  }
  return arbs;
}

function expectedOutcomes(first: NormalizedOdd): Set<string> | null {
  switch (first.market) {
    case 'totals':
      return new Set(['Over', 'Under']);
    case 'spreads':
      return new Set([first.homeTeam, first.awayTeam]);
    case 'h2h':
      return first.sportKey.startsWith('soccer')
        ? new Set([first.homeTeam, first.awayTeam, 'Draw'])
        : new Set([first.homeTeam, first.awayTeam]);
    default:
      // mercado sem forma conhecida: não arrisca arb falso
      return null;
  }
}

function detectArb(arbKey: string, group: NormalizedOdd[]): Arb | null {
  const first = group[0];
  const expected = expectedOutcomes(first);
  if (!expected) return null;

  const best = new Map<string, ArbLeg>();
  for (const odd of group) {
    if (!expected.has(odd.outcome)) continue;
    const current = best.get(odd.outcome);
    if (!current || odd.price > current.price) {
      best.set(odd.outcome, { bookmaker: odd.bookmaker, outcome: odd.outcome, price: odd.price });
    }
  }
  if (best.size !== expected.size) return null;

  const legs = [...best.values()];
  if (new Set(legs.map((leg) => leg.bookmaker)).size < 2) return null;

  const sum = legs.reduce((acc, leg) => acc + 1 / leg.price, 0);
  if (sum >= 1) return null;

  return {
    arbKey,
    eventId: first.eventId,
    market: first.market,
    point: lineKey(first.market, first.point),
    profitPct: Math.round((1 / sum - 1) * 100 * 10000) / 10000,
    legs,
  };
}
