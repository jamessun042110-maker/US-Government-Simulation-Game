import { US_RING, STATES, BORDER_CA, BORDER_MX, CANADA_RING, MEXICO_RING } from '../js/atlas.js';
import { centroid } from '../js/geo.js';
const d = (p) => p.map((q,i)=>(i?'L':'M')+q[0]+' '+q[1]).join(' ')+' Z';
const line = (p) => p.map((q,i)=>(i?'L':'M')+q[0]+' '+q[1]).join(' ');
const cols = ['#4a6fa5','#5b8c5a','#a5794a','#8c5a7a','#4a8c8c','#a58c4a','#6a5aa5','#a55a5a'];
const states = STATES.map((s,i)=>{
  const c = centroid(s.poly);
  return `<path d="${d(s.poly)}" fill="${cols[i%cols.length]}" fill-opacity=".55" stroke="#fff" stroke-width=".6"/>
  <text x="${c[0]}" y="${c[1]}" font-size="3.6" fill="#fff" text-anchor="middle" font-family="sans-serif">${s.abbr}</text>`;
}).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 232" width="100%" style="max-width:100vw;height:auto;display:block">
<rect width="340" height="232" fill="#16202c"/>
<path d="${d(CANADA_RING)}" fill="#2b3a4a"/><path d="${d(MEXICO_RING)}" fill="#3a2b2b"/>
<path d="${d(US_RING)}" fill="#1e2b3a" stroke="#7f9ac0" stroke-width="1"/>
${states}
<path d="${line(BORDER_CA)}" fill="none" stroke="#e0b64a" stroke-width="1.2"/>
<path d="${line(BORDER_MX)}" fill="none" stroke="#e07a4a" stroke-width="1.2"/>
</svg>`;
console.log(svg);
