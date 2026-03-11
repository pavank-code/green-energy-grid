import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto('https://www.99acres.com/agricultural-land-for-sale-in-bangalore-ffid', { waitUntil: 'networkidle2' });

    const html = await page.content();
    fs.writeFileSync('99acres_dump.html', html);
    console.log('Dumped ' + html.length + ' bytes to 99acres_dump.html');
    await browser.close();
})();
