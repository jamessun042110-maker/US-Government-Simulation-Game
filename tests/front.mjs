const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const GEO = await import(base + 'geo.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase='live'; w.inaugurated=0;
  w.seats.find(s=>s.office==='president').personaId = w.players.p1.personaId;
  return w;
};
const w = mk();
const g = GEO.geography(w.nation, w.mapSeed||0);

ok('no war means no band', DEP.occupations(w, g).length === 0);

// A war we are winning.
const f = w.foreign.find(x=>x.id==='canada');
f.atWar = true;
w.military.wars.push({ id:'w1', foreign:'canada', started:0, front:60, exhaustion:0 });
const b = DEP.occupations(w, g)[0];
ok('a moved front makes ground', !!b, b ? `depth ${b.depth.toFixed(1)} byUs ${b.byUs}` : 'none');
ok('winning holds their land', b.byUs === true);
// The band must sit north of the border (into Canada).
const midA = g.borders.a[Math.floor(g.borders.a.length/2)];
const inBand = b.poly.filter(p => Math.abs(p[0]-midA[0]) < 6);
ok('and it lies on their side', inBand.some(p => p[1] < midA[1]), `border y ${midA[1].toFixed(1)}`);

// Losing puts it on ours.
w.military.wars[0].front = -60;
const b2 = DEP.occupations(w, g)[0];
ok('losing gives up ours', b2.byUs === false);
const inBand2 = b2.poly.filter(p => Math.abs(p[0]-midA[0]) < 6);
ok('on our side of the line', inBand2.some(p => p[1] > midA[1]));

// A still front holds no ground; a finished war holds none either.
w.military.wars[0].front = 0;
ok('a still front holds nothing', DEP.occupations(w, g).length === 0);
w.military.wars[0].front = 80; w.military.wars[0].won = true;
ok('a finished war holds nothing', DEP.occupations(w, g).length === 0);

// The island power moves no ground at all.
const sab = w.foreign.find(x=>x.id==='sab');
sab.atWar = true;
w.military.wars.push({ id:'w2', foreign:'sab', started:0, front:70, exhaustion:0 });
ok('an island war moves no border', DEP.occupations(w, g).every(x=>x.foreign.id!=='sab'));

// --- and nothing underneath moved -------------------------------------------
const before = JSON.stringify(GEO.cityGeometry(w).cells.map(c=>c.district.id));
const beforeLand = JSON.stringify(GEO.geography(w.nation, w.mapSeed||0).halves.silver.slice(0,20));
for (let i=0;i<50;i++) S.tick(w);
ok('districts are untouched by occupation', JSON.stringify(GEO.cityGeometry(w).cells.map(c=>c.district.id)) === before);
ok('and so is the border geometry', JSON.stringify(GEO.geography(w.nation, w.mapSeed||0).halves.silver.slice(0,20)) === beforeLand);
ok('parcels still belong to districts', w.city.parcels.every(p => !p.district || w.districts.some(d=>d.id===p.district)));
