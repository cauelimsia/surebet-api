import type { Arb, ArbLeg, NormalizedOdd } from './types.js';

function lineKey(odd: Pick<NormalizedOdd, 'market' | 'point' | 'outcome' | 'homeTeam'>): number {
  switch (odd.market) {
    case 'spreads':
      // linha assinada relativa ao mandante: só linhas complementares (favorito
      // e azarão do mesmo confronto) caem no mesmo grupo. Usar |point| juntava
      // "Lakers -2.5" com "Celtics -2.5" (favoritos opostos) na mesma chave.
      return odd.outcome === odd.homeTeam ? odd.point : -odd.point;
    case 'totals':
      return odd.point;
    default:
      return 0;
  }
}

export function computeArbs(odds: NormalizedOdd[]): Arb[] {
  const groups = new Map<string, NormalizedOdd[]>();
  for (const odd of odds) {
    const key = `${odd.eventId}|${odd.market}|${lineKey(odd)}`;
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
      best.set(odd.outcome, {
        bookmaker: odd.bookmaker,
        outcome: odd.outcome,
        price: odd.price,
        point: odd.point,
      });
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
    point: lineKey(first),
    profitPct: Math.round((1 / sum - 1) * 100 * 10000) / 10000,
    legs,
  };
}
