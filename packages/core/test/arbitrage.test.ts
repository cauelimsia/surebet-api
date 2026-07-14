import { describe, expect, it } from 'vitest';
import { computeArbs, type NormalizedOdd } from '../src/index.js';

function makeOdd(partial: Partial<NormalizedOdd>): NormalizedOdd {
  return {
    eventId: 'ev1',
    sportKey: 'basketball_nba',
    homeTeam: 'Lakers',
    awayTeam: 'Celtics',
    commenceTime: '2026-07-14T00:00:00Z',
    bookmaker: 'bookA',
    market: 'h2h',
    outcome: 'Lakers',
    point: 0,
    price: 2.0,
    lastUpdate: '2026-07-13T12:00:00Z',
    ...partial,
  };
}

describe('computeArbs', () => {
  it('detecta arb 2-way em totals com lucro correto', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 210.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 210.5, price: 2.1, bookmaker: 'bookB' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitPct).toBeCloseTo(5.0, 4);
    expect(arbs[0].arbKey).toBe('ev1|totals|210.5');
    expect(arbs[0].legs).toHaveLength(2);
    for (const leg of arbs[0].legs) {
      expect(leg.point).toBe(210.5);
    }
  });

  it('detecta arb 3-way em h2h de futebol', () => {
    const soccer = { sportKey: 'soccer_epl', market: 'h2h', homeTeam: 'Arsenal', awayTeam: 'Chelsea' };
    const odds = [
      makeOdd({ ...soccer, outcome: 'Arsenal', price: 3.9, bookmaker: 'bookA' }),
      makeOdd({ ...soccer, outcome: 'Draw', price: 4.0, bookmaker: 'bookB' }),
      makeOdd({ ...soccer, outcome: 'Chelsea', price: 2.2, bookmaker: 'bookC' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitPct).toBeCloseTo(4.063, 2);
    expect(arbs[0].legs).toHaveLength(3);
  });

  it('não reporta arb quando soma dos inversos >= 1', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 1.9, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 1.9, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('escolhe a melhor odd de cada resultado entre as casas', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 1.8, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookB' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    const over = arbs[0].legs.find((l) => l.outcome === 'Over');
    expect(over?.bookmaker).toBe('bookB');
    expect(over?.price).toBe(2.1);
  });

  it('descarta arb com todas as legs na mesma casa', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('descarta h2h de futebol sem o empate cotado (falso 2-way)', () => {
    const soccer = { sportKey: 'soccer_epl', market: 'h2h', homeTeam: 'Arsenal', awayTeam: 'Chelsea' };
    const odds = [
      makeOdd({ ...soccer, outcome: 'Arsenal', price: 2.2, bookmaker: 'bookA' }),
      makeOdd({ ...soccer, outcome: 'Chelsea', price: 2.2, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('agrupa spreads por linha assinada relativa ao mandante (linhas complementares)', () => {
    const odds = [
      makeOdd({ market: 'spreads', outcome: 'Lakers', point: -1.5, price: 2.05, bookmaker: 'bookA' }),
      makeOdd({ market: 'spreads', outcome: 'Celtics', point: 1.5, price: 2.05, bookmaker: 'bookB' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].arbKey).toBe('ev1|spreads|-1.5');
  });

  it('NÃO reporta arb quando as duas casas cotam o mesmo favorito na mesma linha (regressão do bug de |point|)', () => {
    // Lakers -2.5 na bookA e Celtics -2.5 na bookB: favoritos opostos, mesmo
    // valor absoluto de linha. Math.abs(point) juntava as duas na mesma
    // chave e emitia um "arb" que perde as duas pernas se Lakers vencer por 1-2.
    const odds = [
      makeOdd({ market: 'spreads', outcome: 'Lakers', point: -2.5, price: 2.05, bookmaker: 'bookA' }),
      makeOdd({ market: 'spreads', outcome: 'Celtics', point: -2.5, price: 2.05, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('detecta arb válido de spreads complementar e expõe o point assinado de cada leg', () => {
    const odds = [
      makeOdd({ market: 'spreads', outcome: 'Lakers', point: -2.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ market: 'spreads', outcome: 'Celtics', point: 2.5, price: 2.1, bookmaker: 'bookB' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].arbKey).toBe('ev1|spreads|-2.5');

    const lakersLeg = arbs[0].legs.find((l) => l.outcome === 'Lakers');
    const celticsLeg = arbs[0].legs.find((l) => l.outcome === 'Celtics');
    expect(lakersLeg?.point).toBe(-2.5);
    expect(celticsLeg?.point).toBe(2.5);
  });

  it('point da leg reflete a linha do próprio mercado (totals = linha, h2h = 0)', () => {
    const totalsOdds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 5.5, price: 2.05, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 5.5, price: 2.05, bookmaker: 'bookB' }),
    ];
    const totalsArbs = computeArbs(totalsOdds);
    expect(totalsArbs).toHaveLength(1);
    expect(totalsArbs[0].legs.every((l) => l.point === 5.5)).toBe(true);

    const h2hOdds = [
      makeOdd({ market: 'h2h', outcome: 'Lakers', price: 2.05, bookmaker: 'bookA' }),
      makeOdd({ market: 'h2h', outcome: 'Celtics', price: 2.05, bookmaker: 'bookB' }),
    ];
    const h2hArbs = computeArbs(h2hOdds);
    expect(h2hArbs).toHaveLength(1);
    expect(h2hArbs[0].legs.every((l) => l.point === 0)).toBe(true);
  });

  it('não mistura linhas diferentes de totals', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.5, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 3.5, price: 2.5, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('ignora grupo com um único resultado cotado', () => {
    const odds = [makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 3.0 })];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('eventos diferentes não se misturam', () => {
    const odds = [
      makeOdd({ eventId: 'ev1', market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ eventId: 'ev2', market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });

  it('rejeita outcome fora do vocabulário do mercado (label sujo)', () => {
    const odds = [
      makeOdd({ market: 'totals', outcome: 'Over', point: 2.5, price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ market: 'totals', outcome: 'Under', point: 2.5, price: 2.1, bookmaker: 'bookB' }),
      makeOdd({ market: 'totals', outcome: 'Over ', point: 2.5, price: 9.9, bookmaker: 'bookC' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].legs).toHaveLength(2);
    for (const leg of arbs[0].legs) {
      expect(leg.price).toBe(2.1);
    }
  });

  it('detecta arb 2-way em h2h de basquete', () => {
    const odds = [
      makeOdd({ outcome: 'Lakers', price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ outcome: 'Celtics', price: 2.1, bookmaker: 'bookB' }),
    ];
    const arbs = computeArbs(odds);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitPct).toBeCloseTo(5.0, 4);
    for (const leg of arbs[0].legs) {
      expect(leg.point).toBe(0);
    }
  });

  it('rejeita h2h com outcome que não é nenhum dos times', () => {
    const odds = [
      makeOdd({ outcome: 'Lakers', price: 2.1, bookmaker: 'bookA' }),
      makeOdd({ outcome: 'Warriors', price: 2.1, bookmaker: 'bookB' }),
    ];
    expect(computeArbs(odds)).toHaveLength(0);
  });
});
