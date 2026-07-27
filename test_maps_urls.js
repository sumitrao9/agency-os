const { buildSearchUrl, ZOOM_IN_JS, ZOOM_OUT_JS, panJs } = require('./src/scraper/pageScraper');
const { JSDOM } = require('jsdom');
let PASS=0,FAIL=0;
function check(l,c,d=''){ if(c){PASS++;console.log('  PASS  '+l);} else {FAIL++;console.log('  FAIL  '+l+(d?' -> '+d:''));} }

console.log('=== MULTI-PLATFORM URL BUILDER ===');
const sources = { google:'google.com/maps', bing:'bing.com/maps', yelp:'yelp.com', yellowpages:'yellowpages.com',
  yell:'yell.com', justdial:'justdial.com', indiamart:'indiamart.com', openstreetmap:'openstreetmap.org' };
for (const [src, expected] of Object.entries(sources)) {
  const url = buildSearchUrl(src, 'plumber', 'Austin Texas');
  check(`${src} URL correct`, url.includes(expected) && url.includes('plumber'), url);
}
check('Unknown source returns empty string, not a crash', buildSearchUrl('nonexistent', 'x', 'y') === '');

console.log('\n=== ZOOM/PAN JS VALID SYNTAX ===');
try {
  const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
  const r1 = dom.window.eval(ZOOM_IN_JS);
  check('ZOOM_IN_JS executes without throwing', typeof r1 === 'boolean');
  const r2 = dom.window.eval(ZOOM_OUT_JS);
  check('ZOOM_OUT_JS executes without throwing', typeof r2 === 'boolean');
  const r3 = dom.window.eval(panJs('right'));
  check('panJs("right") executes without throwing', typeof r3 === 'boolean');
  const r4 = dom.window.eval(panJs('invalid-direction'));
  check('panJs with invalid direction returns false, not a crash', r4 === false);
} catch (e) {
  check('Zoom/pan scripts are syntactically valid', false, e.message);
}

console.log('');
console.log(`TOTAL: ${PASS} passed, ${FAIL} failed`);
