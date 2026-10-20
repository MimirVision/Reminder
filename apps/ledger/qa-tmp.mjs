import { chromium } from '@playwright/test';
const QA = '/tmp/claude-0/-home-user-Reminder/293333bb-f5c3-5a26-b8cf-c4e9f2742589/scratchpad/qa';
const B = 'http://localhost:5182';
const routes = [
  ['home','/'],['tasks','/tasks'],['board','/tasks', async p => { await p.getByRole('radio',{name:'Board'}).click(); await p.waitForTimeout(500); }],
  ['cal-month','/calendar?view=month'],['cal-week','/calendar?view=week'],['cal-day','/calendar?view=day'],
  ['clients','/clients'],['client1','/clients/client-1'],['recurring','/recurring'],['missing','/missing'],['settings','/settings'],
];
const setups = [['desk-light',{width:1440,height:900},false],['phone-light',{width:390,height:844},false],['desk-dark',{width:1440,height:900},true]];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
for (const [sname, vp, dark] of setups) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: vp.width<500, isMobile: vp.width<500 });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error' || m.type()==='warning') errors.push(`${sname} [${m.type()}] ${p.url()}: ${m.text()}`); });
  p.on('pageerror', e => errors.push(`${sname} pageerror ${p.url()}: ${e.message}`));
  await p.goto(B + '/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1500);
  if (dark) {
    await p.goto(B + '/settings'); await p.waitForTimeout(1200);
    await p.getByRole('radio',{name:'Dark'}).click(); await p.waitForTimeout(800);
  }
  for (const [name, path, act] of routes) {
    await p.goto(B + path); await p.waitForTimeout(1500);
    if (act) await act(p);
    const info = await p.evaluate(() => {
      const sw = document.documentElement.scrollWidth, iw = Math.min(innerWidth, screen.width);
      const wide = [];
      if (sw > iw) for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > iw + 1 && r.width>0) wide.push(el.tagName + '.' + (el.className?.toString?.()||'').slice(0,60) + ' r=' + Math.round(r.right)); }
      const small = [];
      if (iw < 500) for (const el of document.querySelectorAll('button,a,[role=radio],input,select')) { const r = el.getBoundingClientRect(); if (r.width>0 && (r.height<32 || r.width<32)) small.push(`${el.tagName} "${(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,25)}" ${Math.round(r.width)}x${Math.round(r.height)}`); }
      return { sw, iw, theme: document.documentElement.dataset.theme, wide: wide.slice(0,8), small: small.slice(0,15), smallCount: small.length };
    });
    console.log(sname, name, JSON.stringify(info));
    await p.screenshot({ path: `${QA}/${sname}-${name}.png`, fullPage: true });
    if (name === 'client1') {
      const tabs = await p.getByRole('tab').all();
      for (let i=0;i<tabs.length;i++) { const t = (await tabs[i].textContent()).trim().replace(/\W+/g,'_'); await tabs[i].evaluate(e=>e.click()); await p.waitForTimeout(600);
        const sw = await p.evaluate(()=>{const iw=Math.min(innerWidth,screen.width);const w=[];for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(r.right>iw+1&&r.width>0&&r.width<2000)w.push(el.tagName+'.'+(el.className?.toString?.()||'').slice(0,50)+' r='+Math.round(r.right))}return [document.documentElement.scrollWidth, innerWidth, w.slice(0,6)]}); console.log(sname,'client1 tab',t,sw);
        await p.screenshot({ path: `${QA}/${sname}-client1-tab${i}-${t}.png`, fullPage: true }); }
    }
  }
  await ctx.close();
}
await browser.close();
console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
