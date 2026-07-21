// ui.spec.js ke Layout > overflow test ko ISSE replace karo.
//
// Purana test har element ka bounding-rect dekhta tha. Problem: "Today's Meals"
// jaise horizontal-scroll carousel ke cards jaanbujh ke viewport se chaude hote
// hain — wo apne container me scroll hote hain, page nahi tootta. Isliye wo test
// jhoothi failure de raha tha.
//
// Naya test wahi dekhta hai jo user ko actually dikhta hai:
//   1) page khud horizontally scroll to nahi ho raha?
//   2) agar ho raha hai, to kaunsa element wajah hai (scroll-container ke andar
//      wale skip, kyunki wo intentional hain)

for (const mode of ['light', 'dark']) {
  test(`${mode}: koi horizontal overflow nahi`, async ({ page }) => {
    await page.goto(URL);
    if (mode === 'dark') {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    }

    for (const tab of TABS) {
      await gotoTab(page, tab);
      await page.waitForTimeout(300);

      const result = await page.evaluate(() => {
        const de = document.documentElement;

        // 1) Asli sawaal: page horizontally scroll ho raha hai?
        const pageOverflow = Math.max(de.scrollWidth, document.body.scrollWidth)
                             > de.clientWidth + 1;
        if (!pageOverflow) return { pageOverflow: false, culprits: [] };

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
          .map(el => `${el.tagName}.${(el.className || '').toString().slice(0, 40)} (right=${Math.round(el.getBoundingClientRect().right)})`);

        return { pageOverflow: true, culprits, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
      });

      expect(
        result.pageOverflow,
        `${tab} par page horizontally scroll ho raha hai ` +
        `(scrollWidth=${result.scrollWidth} vs clientWidth=${result.clientWidth}). ` +
        `Wajah: ${JSON.stringify(result.culprits)}`
      ).toBe(false);
    }
  });
}
