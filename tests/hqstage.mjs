// The fourth storey of a company: a $200M campus of its own, above the tower.
const base = new URL('../js/', import.meta.url).href;
const CO = await import(base + 'company.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const hq = CO.STAGES.find((s) => s.id === 'hq');
ok('there is an hq stage', !!hq);
ok('it opens at $200M', hq && hq.at === 2e8, String(hq?.at));
ok('and it sits above the tower', CO.STAGES.findIndex((s) => s.id === 'hq') > CO.STAGES.findIndex((s) => s.id === 'tower'));

ok('a company worth $200M is at the campus', CO.stageOf(2e8).id === 'hq', CO.stageOf(2e8).id);
ok('one just short is still in the tower', CO.stageOf(1.99e8).id === 'tower', CO.stageOf(1.99e8).id);
ok('the next storey above the tower is the campus', CO.nextStage(1e8).id === 'hq', CO.nextStage(1e8)?.id);
ok('nothing is above the campus', CO.nextStage(3e8) === null);

// The move-in line reads from the stage, not a hard-coded office name.
ok('the campus has its own move-in phrase', hq.moveInto && /campus/.test(hq.moveInto), hq.moveInto);
ok('the tower kept its phrase too', CO.STAGES.find((s) => s.id === 'tower').moveInto === 'a tower downtown');
