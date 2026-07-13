import type { NormalizedOdd } from '@surebet/core';
import type { OddsApiEvent } from './odds-api.js';

export function normalizeEvents(events: OddsApiEvent[]): NormalizedOdd[] {
  const rows: NormalizedOdd[] = [];
  for (const event of events) {
    for (const bookmaker of event.bookmakers) {
      for (const market of bookmaker.markets) {
        for (const outcome of market.outcomes) {
          rows.push({
            eventId: event.id,
            sportKey: event.sport_key,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            commenceTime: event.commence_time,
            bookmaker: bookmaker.key,
            market: market.key,
            outcome: outcome.name,
            point: outcome.point ?? 0,
            price: outcome.price,
            lastUpdate: market.last_update,
          });
        }
      }
    }
  }
  return rows;
}
