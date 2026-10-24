/**
 * Same-store rent (Leasing Details ▸ Rent & Same-Store): the grains that were 100% leased in BOTH
 * years with no excluded lease touching them, so the rent change is like for like.
 *   grain = unit (or the whole property when either year places a property-wide whole-house lease,
 *   or the property has no unit records)
 * Marks lr.sameStore / lr.ssWhy on the current year's leaf results. Pure.
 */
export function markSameStore(inventory, cur, prior) {
  const tally = { grains: 0, beds: 0, dropped: { excluded: 0, vacantCur: 0, vacantPrior: 0 }, droppedBeds: { excluded: 0, vacantCur: 0, vacantPrior: 0 } };
  for (const lr of cur.leafResults.values()) { lr.sameStore = false; lr.ssWhy = prior ? null : 'noPrior'; }
  if (!prior) return tally;
  const index = (placement) => {
    const ex = { byProp: new Set(), byUnit: new Set(), byBed: new Set(), unattributed: new Set(), whProp: new Set() };
    for (const r of placement.leaseResults.values()) {
      if (r.status === 'placed' && r.scope.level === 'property') ex.whProp.add(r.scope.propertyId);
      if (r.status !== 'excluded') continue;
      const s = r.scope;
      if (s.level === 'bedroom') ex.byBed.add(s.bedroomId); else if (s.level === 'unit') ex.byUnit.add(s.unitId); else if (s.level === 'property') ex.byProp.add(s.propertyId);
      else if (r.lease.propertyId) ex.unattributed.add(r.lease.propertyId);
    }
    return ex;
  };
  const exCur = index(cur), exPrior = index(prior);
  for (const p of inventory.propertiesById.values()) {
    const propGrain = p.units.length === 0 || exCur.whProp.has(p.id) || exPrior.whProp.has(p.id);
    const grains = propGrain
      ? [{ leaves: p.leaves, whole: true, unitIds: p.units, bedIds: p.units.flatMap((uid) => inventory.unitsById.get(uid).bedrooms.map((b) => b.id)) }]
      : p.units.map((uid) => { const u = inventory.unitsById.get(uid); return { leaves: u.leaves, whole: false, unitIds: [u.id], bedIds: u.bedrooms.map((b) => b.id) }; });
    for (const g of grains) {
      const beds = g.leaves.reduce((s, l) => s + l.beds, 0);
      if (beds <= 0) continue;
      const touched = (ex) => ex.unattributed.has(p.id) || (g.whole && ex.byProp.has(p.id)) || (!g.whole && ex.byProp.has(p.id)) || g.unitIds.some((id) => ex.byUnit.has(id)) || g.bedIds.some((id) => ex.byBed.has(id));
      let why = null;
      if (touched(exCur) || touched(exPrior)) why = 'excluded';
      else if (g.leaves.some((l) => l.beds > 0 && !cur.leafResults.get(l.key).occupied)) why = 'vacantCur';
      else if (g.leaves.some((l) => l.beds > 0 && !(prior.leafResults.get(l.key) || { occupied: 0 }).occupied)) why = 'vacantPrior';
      for (const l of g.leaves) { const lr = cur.leafResults.get(l.key); lr.sameStore = !why; lr.ssWhy = why; }
      if (why) { tally.dropped[why] += 1; tally.droppedBeds[why] += beds; } else { tally.grains += 1; tally.beds += beds; }
    }
  }
  return tally;
}
