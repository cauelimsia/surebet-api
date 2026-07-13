export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface FetchOddsResult {
  events: OddsApiEvent[];
  requestsRemaining: number | null;
  requestsUsed: number | null;
}

function parseQuotaHeader(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function fetchOdds(
  sportKey: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchOddsResult> {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', 'eu,uk');
  url.searchParams.set('markets', 'h2h,totals,spreads');
  url.searchParams.set('oddsFormat', 'decimal');

  const res = await fetchFn(url.toString());
  if (!res.ok) {
    throw new Error(`odds api ${res.status}: ${await res.text()}`);
  }
  const events = (await res.json()) as OddsApiEvent[];
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  return {
    events,
    requestsRemaining: parseQuotaHeader(remaining),
    requestsUsed: parseQuotaHeader(used),
  };
}
