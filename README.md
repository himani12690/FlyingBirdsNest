# UI Tests — Nest & Nosh

Browser me app ko asli phone jaisa render karke automatically check karta hai.
Ye wo bugs pakadta hai jo pehle sirf screenshot dekhkar pakde ja rahe the.

## Setup (ek hi baar)

```bash
npm run setup
```

Ye do kaam karta hai — `npm install` aur Chromium download (~120 MB).

> Node.js chahiye. Na ho to nodejs.org se install kar lo.

## Chalao

```bash
npm test              # saare tests
npm run test:report   # HTML report + screenshots kholo
npm run test:ui       # interactive mode (debug ke liye best)
```

Ek test chalane ke liye:

```bash
npx playwright test -g "icons"
```

## Kya check hota hai

| Test | Kya pakadta hai |
|---|---|
| **JS / console errors** | Chup-chaap fail hone wale errors |
| **Icons** | SVG sprite delete ho jaye ya `<use>` ka symbol na mile (ye ek baar ho chuka hai) |
| **Horizontal overflow** | Koi element screen se bahar nikal jaye |
| **Sticky bar overlap** | Neeche ka content "Order Now" bar ke peeche chhup jaye |
| **Dark mode readability** | Text apne background me ghul jaye (white-on-white wala bug) |
| **Screenshots** | Har screen ka photo, light + dark — report me dikhta hai |

## Zaroori baatein

**Backend call nahi hota.** Saare API responses `tests/helpers.js` me stub kiye hue hain. Matlab:
- Test hamesha same result deta hai (asli data badalne se fail nahi hota)
- Internet ke bina bhi chalta hai
- **Asli orders ya Google Sheet kabhi ganda nahi hota**

Iska matlab ye bhi hai ki ye tests **UI aur JavaScript** check karte hain — asli order placement,
Google login, aur payment **manually hi test karna padega**.

## Naya test add karna ho

`tests/ui.spec.js` me likho. Fake data badalna ho to `tests/helpers.js` me `CONFIG` / `MENU` / `ORDERS` edit karo.

## Deploy se pehle

```bash
npm test
```

Sab green ho tabhi `index.html` GitHub par push karo.
