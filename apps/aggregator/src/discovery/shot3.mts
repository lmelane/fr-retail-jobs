import { chromium } from 'playwright';
const out = '/private/tmp/claude-501/-Users-lmelane-Downloads-catwalks-job-aggregator/cb987be9-6318-41c2-be50-828162123854/scratchpad';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://modecareers.com/intelligence?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 90000 });
await page.screenshot({ path: `${out}/prod-intel-home.png`, fullPage: true });
await page.goto('https://modecareers.com/intelligence/maisons/cartier?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 90000 });
await page.screenshot({ path: `${out}/prod-intel-cartier.png`, clip: { x: 0, y: 0, width: 1440, height: 1500 } });
await b.close(); console.log('shots ok');
