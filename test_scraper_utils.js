const { buildSearchUrl, ZOOM_IN_JS, ZOOM_OUT_JS, panJs } = require('./src/scraper/pageScraper');
const { JSDOM } = require('jsdom');
let PASS=0,FAIL=0;
function check(l,c,d=''){ if(c){PASS++;console.log('  PASS  '+l);} else {FAIL++;console.log('  FAIL  '+l+(d?' -> '+d:''));} }

console.log('=== MULTI-PLATFORM URL BUILDING (all 8 sources) ===');
const sources = {
  google: 'google.com/maps', bing: 'bing.com/maps', yelp: 'yelp.com',
  yellowpages: 'yellowpages.com', yell: 'yell.com', justdial: 'justdial.com',
  indiamart: 'indiamart.com', openstreetmap: 'openstreetmap.org',
};
for (const [src, expected] of Object.entries(sources)) {
  const url = buildSearchUrl(src, 'plumber', 'Austin Texas');
  check(`${src} builds a valid URL`, url.includes(expected) && url.includes('plumber'), url);
}
check('Unknown source returns empty string, not a crash', buildSearchUrl('not-a-real-source', 'x', 'y') === '');

console.log('\n=== ZOOM/PAN JS VALIDITY (real Node execution, not just syntax) ===');
{
  const dom = new JSDOM('<html><body><button aria-label="Zoom in">+</button></body></html>', { runScripts: 'dangerously' });
  const clicked = dom.window.eval(ZOOM_IN_JS);
  check('ZOOM_IN_JS executes without throwing and returns true when a real button exists', clicked === true);
}
{
  const dom = new JSDOM('<html><body><button aria-label="Zoom out">-</button></body></html>', { runScripts: 'dangerously' });
  const clicked = dom.window.eval(ZOOM_OUT_JS);
  check('ZOOM_OUT_JS executes without throwing and returns true when a real button exists', clicked === true);
}
{
  const dom = new JSDOM('<html><body><div id="map"></div></body></html>', { runScripts: 'dangerously' });
  const script = panJs('right');
  const result = dom.window.eval(script);
  check('panJs("right") produces valid, executable JS', result === true);
  check('panJs correctly substitutes the direction argument', script.includes("keyMap['right']"));
}
{
  const script = panJs('invalid-direction');
  const dom = new JSDOM('<html><body></body></html>', { runScripts: 'dangerously' });
  const result = dom.window.eval(script);
  check('panJs with an invalid direction fails safely (returns false, does not throw)', result === false);
}

console.log('');
console.log(`TOTAL: ${PASS} passed, ${FAIL} failed`);
