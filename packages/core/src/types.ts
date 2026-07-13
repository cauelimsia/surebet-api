export interface NormalizedOdd {
  eventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmaker: string;
  market: string;
  outcome: string;
  point: number;
  price: number;
  lastUpdate: string;
}

export interface ArbLeg {
  bookmaker: string;
  outcome: string;
  price: number;
}

export interface Arb {
  arbKey: string;
  eventId: string;
  market: string;
  point: number;
  profitPct: number;
  legs: ArbLeg[];
}
