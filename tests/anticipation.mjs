// Ground broken on housing or jobs eases the disapproval it will answer — but
// only by a tenth, before the building opens. The other nine tenths arrive when
// the homes or jobs are real. A district under construction should read a little
// less angry about the cause being built against, and no other cause.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
const d = w.districts[0];
d.homeless = Math.round(d.pop * 0.15); d.salience.housing = 1;
d.unemployment = 0.12; d.salience.jobs = 1;
const parcel = w.city.parcels.find((p) => p.district === d.id);
ok('the district has a parcel to build on', !!parcel);
parcel.project = null;

// The full penalties, with nothing under construction.
const full = S.districtMoodTarget(w, d);

// Break ground on housing: the housing disapproval eases by exactly a tenth.
parcel.project = { building: 'housing_low', started: 0, ticks: 240, progress: 0, cost: 8e6 };
const withHousing = S.districtMoodTarget(w, d);
ok('breaking ground on housing eases housing disapproval', withHousing.parts.Housing > full.parts.Housing,
  `${full.parts.Housing.toFixed(1)} -> ${withHousing.parts.Housing.toFixed(1)}`);
ok('by a tenth of the final impact', Math.abs(withHousing.parts.Housing - full.parts.Housing * 0.9) < 1e-6,
  `${withHousing.parts.Housing.toFixed(2)} vs ${(full.parts.Housing * 0.9).toFixed(2)}`);
ok('and it does not touch unemployment', Math.abs(withHousing.parts.Unemployment - full.parts.Unemployment) < 1e-6);
ok('the overall mood target lifts', withHousing.target > full.target, `${full.target.toFixed(1)} -> ${withHousing.target.toFixed(1)}`);

// Break ground on jobs instead: the unemployment disapproval eases by a tenth.
parcel.project = { building: 'factory', started: 0, ticks: 240, progress: 0, cost: 15e6 };
const withJobs = S.districtMoodTarget(w, d);
ok('breaking ground on jobs eases unemployment disapproval', withJobs.parts.Unemployment > full.parts.Unemployment,
  `${full.parts.Unemployment.toFixed(1)} -> ${withJobs.parts.Unemployment.toFixed(1)}`);
ok('by a tenth of the final impact', Math.abs(withJobs.parts.Unemployment - full.parts.Unemployment * 0.9) < 1e-6);
ok('and it does not touch housing', Math.abs(withJobs.parts.Housing - full.parts.Housing) < 1e-6);

// An amenity under construction (a park) answers neither cause.
parcel.project = { building: 'park', started: 0, ticks: 240, progress: 0, cost: 2e6 };
const withPark = S.districtMoodTarget(w, d);
ok('a park under construction eases neither housing nor jobs',
  Math.abs(withPark.parts.Housing - full.parts.Housing) < 1e-6 && Math.abs(withPark.parts.Unemployment - full.parts.Unemployment) < 1e-6);

// When the building opens (the project is gone), the anticipation ends — the real
// homes or jobs are what move the number from then on.
parcel.project = null;
const opened = S.districtMoodTarget(w, d);
ok('when the project completes the anticipation ends', Math.abs(opened.parts.Housing - full.parts.Housing) < 1e-6);
