import { describe, expect, it } from 'vitest';
import { fetchOdds } from '../src/odds-api.js';

describe('fetchOdds', () => {
  it('monta a URL com sport, mercados e formato decimal e lê headers de quota', async () => {
    let calledUrl = '';
    const fakeFetch = (async (url: RequestInfo | URL) => {
      calledUrl = String(url);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-requests-remaining': '450', 'x-requests-used': '50' },
      });
    }) as typeof fetch;

    const result = await fetchOdds('soccer_epl', 'test-key', fakeFetch);

    expect(calledUrl).toContain('/v4/sports/soccer_epl/odds');
    expect(calledUrl).toContain('apiKey=test-key');
    expect(calledUrl).toContain('regions=eu%2Cuk');
    expect(calledUrl).toContain('markets=h2h%2Ctotals%2Cspreads');
    expect(calledUrl).toContain('oddsFormat=decimal');
    expect(result.events).toEqual([]);
    expect(result.requestsRemaining).toBe(450);
    expect(result.requestsUsed).toBe(50);
  });

  it('lança erro com status em resposta não-ok', async () => {
    const fakeFetch = (async () =>
      new Response('Invalid API key', { status: 401 })) as typeof fetch;
    await expect(fetchOdds('soccer_epl', 'bad', fakeFetch)).rejects.toThrow('401');
  });

  it('header malformado ("x-requests-remaining": "abc") resulta em requestsRemaining null', async () => {
    const fakeFetch = (async (url: RequestInfo | URL) => {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-requests-remaining': 'abc', 'x-requests-used': '50' },
      });
    }) as typeof fetch;

    const result = await fetchOdds('soccer_epl', 'test-key', fakeFetch);

    expect(result.requestsRemaining).toBeNull();
    expect(result.requestsUsed).toBe(50);
  });
});
