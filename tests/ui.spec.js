/**
 * UI smoke tests — Nest & Nosh
 *
 * Ye un bugs ko pakadte hain jo pehle sirf screenshot bhejne par pakde ja rahe the:
 *   • icons gayab ho jana (SVG sprite delete ho jaye)
 *   • dark mode me text invisible (white-on-white)
 *   • layout screen se bahar nikal jana
 *   • sticky bar ke peeche content chhup jana
 *   • JS errors jo chup-chaap fail hote hain
 */
const { test, expect } = require('@playwright/test');
const { openApp, setTheme, goTo } = require('./helpers');

const SCREENS = ['land', 'menu', 'cart', 'orders', 'profile'];

test.describe('App loads', () => {
  test('koi JS ya console error nahi', async ({ page }) => {
    const { errors } = await openApp(page);
    for (const tab of SCREENS) await goTo(page, tab);
    expect(errors, 'Errors:\n' + errors.join('\n')).toEqual([]);
  });

  test('bottom nav ke saare tabs maujood hain', async ({ page }) => {
    await openApp(page);
    for (const tab of SCREENS) {
      await expect(page.locator(`#bn-${tab}`)).toBeVisible();
    }
  });
});

test.describe('Icons', () => {
  // Sprite pehle ek baar galti se delete ho chuka hai — ab test pakad lega
  test('har <use> ka symbol maujood hai', async ({ page }) => {
    await openApp(page);
    const { missing, symbolCount } = await page.evaluate(() => {
      const sym = new Set([...document.querySelectorAll('symbol')].map(s => s.id));
      const ref = new Set([...document.querySelectorAll('use')]
        .map(u => (u.getAttribute('href') || '').replace('#', '')).filter(Boolean));
      return { missing: [...ref].filter(r => !sym.has(r)), symbolCount: sym.size };
    });
    expect(symbolCount, 'SVG sprite gayab hai').toBeGreaterThan(0);
    expect(missing, 'In icons ka symbol nahi mila').toEqual([]);
  });

  test('nav icons ki actual width hai (render ho rahe hain)', async ({ page }) => {
    await openApp(page);
    const zero = await page.evaluate(() =>
      [...document.querySelectorAll('.bn-item .ic')]
        .filter(i => i.getBoundingClientRect().width === 0).length);
    expect(zero, 'Kuch nav icons render nahi hue').toBe(0);
  });
});

test.describe('Layout', () => {
  // Purana test har element ka bounding-rect dekhta tha — lekin "Today's Meals"
  // (#homeMealRow) aur .about-slides jaise carousel jaanbujh ke viewport se chaude
  // hote hain; wo apne container me scroll karte hain, page nahi tootta.
  // Isliye ab wahi check hota hai jo user ko actually dikhta hai: page khud
  // horizontally scroll to nahi ho raha?
  for (const theme of ['light', 'dark']) {
    test(`${theme}: koi horizontal overflow nahi`, async ({ page }) => {
      await openApp(page, { theme });
      for (const tab of SCREENS) {
        await goTo(page, tab);
        await page.waitForTimeout(300);

        const result = await page.evaluate(() => {
          const de = document.documentElement;

          // 1) Asli sawaal: page horizontally scroll ho raha hai?
          const overflow = Math.max(de.scrollWidth, document.body.scrollWidth)
                           > de.clientWidth + 1;
          if (!overflow) return { overflow: false, culprits: [] };

          // 2) Ho raha hai to wajah dhoondo — scroll-container ke andar wale chhodo
          const insideScroller = (el) => {
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
            }
            return false;
          };

          const culprits = [...document.querySelectorAll('body *')]
            .filter(el => {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') return false;
              if (insideScroller(el)) return false;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              return r.right > de.clientWidth + 1;
            })
            .slice(0, 5)
            .map(el => `${el.tagName}#${el.id || '-'}.${(el.className || '').toString().slice(0, 40)}`
                       + ` (right=${Math.round(el.getBoundingClientRect().right)})`);

          return { overflow: true, culprits, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
        });

        expect(
          result.overflow,
          `${tab} par page horizontally scroll ho raha hai `
          + `(scrollWidth=${result.scrollWidth} vs clientWidth=${result.clientWidth}). `
          + `Wajah: ${JSON.stringify(result.culprits)}`
        ).toBe(false);
      }
    });
  }

  test('sticky bar ke peeche content nahi chhupta', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'land');
    // Page scrollable hai, isliye NEECHE tak scroll karke check karo —
    // top par content bar ke peeche hona normal hai.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);

    const clearance = await page.evaluate(() => {
      const bar = document.querySelector('.sticky-bar:not(.hidden)');
      const sec = document.querySelector('#homeView .section');
      if (!bar || !sec) return null;
      const last = [...sec.children].filter(e => e.getBoundingClientRect().height > 0).pop();
      if (!last) return null;
      return bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom;
    });

    if (clearance === null) test.skip();
    expect(clearance, 'Aakhri content sticky bar ke peeche chhup raha hai').toBeGreaterThan(0);
  });
});

test.describe('Dark mode readability', () => {
  // Yahi wo bug tha jahan white text white background par tha
  test('koi text apne background me ghul nahi raha', async ({ page }) => {
    await openApp(page, { theme: 'dark' });
    for (const tab of SCREENS) {
      await goTo(page, tab);
      const bad = await page.evaluate(() => {
        const lum = c => {
          const m = c.match(/\d+/g); if (!m) return null;
          const [r, g, b] = m.map(Number);
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const bgOf = el => {                       // upar chadhte hue asli background dhoondo
          let n = el;
          while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            if (bg && !bg.includes('rgba(0, 0, 0, 0)')) return bg;
            n = n.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        return [...document.querySelectorAll('.container *')]
          .filter(el => {
            if (!el.offsetParent) return false;
            const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
            if (!txt) return false;
            const f = lum(getComputedStyle(el).color), b = lum(bgOf(el));
            return f !== null && b !== null && Math.abs(f - b) < 25;   // lagbhag same
          })
          .slice(0, 5)
          .map(e => (e.tagName + '.' + (e.className || '').toString().slice(0, 30)
                     + ' → "' + e.textContent.trim().slice(0, 25) + '"'));
      });
      expect(bad, `${tab} par text padha nahi ja sakta`).toEqual([]);
    }
  });
});

test.describe('Screenshots', () => {
  // Fail nahi hota — sirf har screen ka photo save karta hai review ke liye
  test('har screen ka snapshot', async ({ page }, testInfo) => {
    await openApp(page);
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      for (const tab of SCREENS) {
        await goTo(page, tab);
        await testInfo.attach(`${tab}-${theme}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    }
  });
});
