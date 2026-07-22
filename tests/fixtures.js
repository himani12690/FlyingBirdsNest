// Backend responses — sab tests yahan se data lete hain
const CONFIG = {
  prices: { breakfast:30, lunch:80, dinner:80, tiffinMini:60,
            extraRotiPlain:12, extraRotiButter:16, dahi:20, extraSabzi:30 },
  township: 'Godrej Garden City',
  societies: ['Vrindavan','Eden'],
  deliveryNear: 10, deliveryFar: 20, farSocieties: ['Eden'],
  closedDates: [], capacity: { breakfast:0, lunch:0, dinner:0 },
  // ⚠️ Order matters — app ka defaultVariantId(m) hamesha variantsFor(m)[0] uthata hai
  // (quickAdd isi se default tiffin decide karta hai). Real app me 'full' hamesha
  // pehla hota hai (index.html defaultVariantsFE) — mock isi order ko match kare,
  // warna quickAdd tests 'mini' pick karke galat total expect karte hain.
  variants: {
    breakfast: [{ id:'std', name:'Breakfast', price:30, items:['Poha','Chai'], img:'' }],
    lunch: [
      { id:'full', name:'Full Tiffin', price:80, items:['Roti (5)','Daal','Chawal'], img:'' },
      { id:'mini', name:'Mini Tiffin', price:60, items:['Roti (4)','1 Sabzi'], img:'' }
    ],
    dinner: [
      { id:'full', name:'Full Tiffin', price:80, items:['Roti (5)','Daal','Chawal'], img:'' },
      { id:'mini', name:'Mini Tiffin', price:60, items:['Roti (4)','1 Sabzi'], img:'' }
    ]
  },
  banners: { breakfast:'', lunch:'', dinner:'' },
  upiId: '7043491481@ybl', upiName: 'Nest & Nosh', fssai: '20724XXXXXXXXXX',
  whatsappAuto: false,
  mealsEnabled: { breakfast:true, lunch:true, dinner:true },
  homeEnabled: true, officeEnabled: false, companies: []
};

const DAY = {
  breakfast: ['Poha','Chai'],
  lunch:  { sabziOptions:['Paneer Butter Masala','Dal Tadka'], fixedItems:['Jeera Rice','Roti (4)'] },
  dinner: { sabziOptions:['Aloo Gobi','Rajma Masala'],        fixedItems:['Steam Rice','Roti (4)'] }
};
const MENU = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
  .reduce((m,d) => (m[d] = JSON.parse(JSON.stringify(DAY)), m), {});

const PROMOS = [{ code:'WELCOME50', label:'₹50 off', minOrder:0, firstOnly:true }];

const SESSION = { token:'test-token-123', name:'Test User', phone:'9876543210' };

module.exports = { CONFIG, MENU, PROMOS, SESSION };
