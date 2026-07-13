import type { Arb } from '@surebet/core';

export interface ActiveArbRef {
  id: string;
  arbKey: string;
}

export interface ArbSyncPlan {
  inserts: Arb[];
  updates: { id: string; arb: Arb }[];
  goneIds: string[];
}

export function planArbSync(current: Arb[], active: ActiveArbRef[]): ArbSyncPlan {
  const activeByKey = new Map(active.map((a) => [a.arbKey, a.id]));
  const currentKeys = new Set(current.map((a) => a.arbKey));

  const inserts: Arb[] = [];
  const updates: { id: string; arb: Arb }[] = [];
  for (const arb of current) {
    const id = activeByKey.get(arb.arbKey);
    if (id) {
      updates.push({ id, arb });
    } else {
      inserts.push(arb);
    }
  }
  const goneIds = active.filter((a) => !currentKeys.has(a.arbKey)).map((a) => a.id);
  return { inserts, updates, goneIds };
}
