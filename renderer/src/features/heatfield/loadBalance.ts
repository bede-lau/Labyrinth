export interface HeatTransfer {
  from: number;
  to: number;
  fraction: number;
}

// Pair the hottest predicted tile with the coolest available receiver.
// Fractions are bounded to split the thermal headroom, using the tile model's
// linear temperature rise above its coolant as a proxy for incoming load.
// With `equalize`, a receiver that is itself above the limit is allowed: when every diverter is hot the hottest
// still hands part of its load to the coolest, up to half the gap between them.
export function balanceTargets(peaks: readonly number[], limit: number, coolant: number, equalize = false): HeatTransfer[] {
  const order = peaks.map((_, i) => i).sort((a, b) => peaks[a]! - peaks[b]!);
  const transfers: HeatTransfer[] = [];
  while (order.length >= 2) {
    const from = order.pop()!, to = order.shift()!;
    const hot = peaks[from]!, cool = peaks[to]!;
    if (hot <= limit || hot <= cool || (cool >= limit && !equalize)) break;
    const headroom = equalize && cool >= limit ? (hot - cool) / 2 : Math.min(limit - cool, (hot - cool) / 2);
    const fraction = Math.min(0.4, headroom / (hot - coolant));
    if (fraction > 0) transfers.push({ from, to, fraction });
  }
  return transfers;
}

// During a handover the old and new routes may overlap. Every share is taken
// from its original source load, independent of the order the routes are listed.
export function distributeLoads(loads: Float64Array, bins: number, transfers: readonly HeatTransfer[]) {
  const incoming = transfers.length > 1 ? loads.slice() : loads;
  for (const { from, to, fraction } of transfers) {
    for (let i = 0; i < bins; i++) {
      const amount = incoming[from * bins + i]! * fraction;
      loads[from * bins + i]! -= amount;
      loads[to * bins + i]! += amount;
    }
  }
}
