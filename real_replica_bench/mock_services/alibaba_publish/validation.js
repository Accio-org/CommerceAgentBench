// Server-side enum + structural validation for /api/submit.
//
// Closed-set fields (radio/select/checkbox) must match the values the UI
// actually exposes; the API used to accept any string, which let an agent
// bypass the form by writing arbitrary text into the hidden inputs. This
// module is the single source of truth for what counts as a legal value.

const ALLOWED = {
  saleMode: ['Domestic Shipping', 'Overseas Stock'],
  saleType: ['Per Piece', 'Per Set', 'Per Lot'],
  priceUnit: ['Piece', 'Set', 'Pair', 'Roll', 'Unit', 'Meter', 'Ton', 'Kilogram'],
  priceMode: ['single', 'ladder'],
  fobType: [
    'FOB Shenzhen', 'FOB Ningbo', 'FOB Shanghai', 'FOB Guangzhou', 'FOB Yiwu',
    'CIF', 'EXW',
  ],
  productVisible: ['yes', 'no'],
  descType: ['custom'],
  agreement: ['true'],
};

const CATEGORY_TREE = {
  'Lights & Lighting': ['LED Lighting > LED Bulbs & Tubes','LED Lighting > LED Strip Lights','Indoor Lighting > Chandeliers','Indoor Lighting > Pendant Lights','Outdoor Lighting > Street Lights','Outdoor Lighting > Solar Lights','Stage Lighting','Lighting Accessories'],
  'Home & Garden': ['Kitchen,Dining & Bar > Cooking Tool Sets','Kitchen,Dining & Bar > Dinnerware Sets','Kitchen,Dining & Bar > Drinkware','Household Sundries > Storage','Garden Supplies > Garden Tools','Home Decor > Vases','Bathroom Products','Home Textile'],
  'Sports & Entertainment': ['Fitness & Body Building > Yoga > Yoga Mats','Fitness & Body Building > Gym Equipment','Camping & Hiking > Water Bottles','Camping & Hiking > Tents','Water Sports > Swimming','Ball Sports > Football','Musical Instruments','Board Games'],
  'Mechanical Parts & Fabrication Services': ['Valves > Ball Valves','Valves > Butterfly Valves','Valves > Gate Valves','Machining > CNC Machining','Pumps > Centrifugal Pumps','Bearings > Ball Bearings','Fasteners > Bolts','Hydraulic Parts'],
  'Consumer Electronics': ['Portable Audio & Video > Earphones & Headphones','Portable Audio & Video > Speakers','Smart Electronics > Smart Watches','Accessories & Parts > Phone Cases','Camera & Photo > Action Cameras','Power Source > Power Banks','VR/AR Devices','Electronic Cigarettes'],
  'Apparel': ['Women Clothing','Men Clothing','Children Clothing','Underwear','Sportswear','Swimwear','Accessories','Costumes'],
  'Beauty & Personal Care': ['Makeup','Skin Care','Hair Care','Fragrance','Nail Art','Beauty Tools','Oral Care','Bath & Body'],
  'Automobiles & Motorcycles': ['Auto Parts > Engine Parts','Auto Parts > Brake System','Auto Electronics','Motorcycle Parts','Car Care','Tires & Wheels','Interior Accessories','Exterior Accessories'],
  'Electrical Equipment & Supplies': ['Switches','Cables & Wires','Transformers','Generators','Connectors','Circuit Breakers','Power Supplies','Solar Cells'],
  'Packaging & Printing': ['Paper Packaging','Plastic Packaging','Label & Tags','Packaging Machinery','Printing Machinery','Bottles & Jars','Bags','Film'],
  'Textiles & Leather Products': ['Cotton Fabric','Synthetic Fabric','Knitted Fabric','Leather','Lace & Trim','Yarn','Non-woven Fabric','Silk'],
  'Rubber & Plastics': ['Rubber Products','Plastic Products','Silicone Products','Foam','Plastic Raw Materials','Rubber Raw Materials'],
  'Construction & Real Estate': ['Tiles','Flooring','Doors & Windows','Plumbing','Steel Structure','Insulation Materials','Decorative Materials','Roofing'],
  'Tools & Hardware': ['Hand Tools','Power Tools','Welding Equipment','Measuring Tools','Fasteners','Abrasives','Locks','Tool Accessories'],
  'Minerals & Metallurgy': ['Steel','Aluminum','Copper','Stainless Steel','Alloy','Wire Mesh','Metal Sheets','Pipes'],
  'Agriculture': ['Farm Machinery','Animal Feed','Seeds & Bulbs','Greenhouses','Fertilizer','Aquaculture','Fresh Produce','Forestry'],
  'Health & Medical': ['Medical Instruments','Diagnostic Equipment','Lab Supplies','Rehabilitation','Personal Protective Equipment','Dental','First Aid','Mobility Aids'],
  'Gifts & Crafts': ['Artificial Crafts','Metal Crafts','Ceramic Crafts','Crystal Crafts','Candles','Photo Frames','Figurines','Souvenirs'],
  'Furniture': ['Living Room','Bedroom','Office','Hotel','Outdoor','Children','Commercial','Metal Furniture'],
  'Security & Protection': ['CCTV','Access Control','Alarm','Fire Protection','Safes','Safety Clothing','Traffic Safety','Inspection Equipment'],
  'Office & School Supplies': ['Stationery','Writing Instruments','Filing Products','Presentation Supplies','School Supplies','Calculators','Desk Organizers','Boards'],
  'Shoes & Accessories': ['Women Shoes','Men Shoes','Children Shoes','Sports Shoes','Slippers','Shoe Materials','Shoe Accessories','Boots'],
  'Luggage & Bags': ['Travel Bags','Backpacks','Handbags','Wallets','Cosmetic Bags','Business Bags','Laptop Bags','Luggage Sets'],
  'Toys & Hobbies': ['Stuffed Toys','Building Blocks','Remote Control Toys','Educational Toys','Dolls','Outdoor Toys','Model Toys','Party Supplies'],
  'Vehicles & Transportation': ['Electric Vehicles','Motorcycles','Bicycles','Golf Carts','ATVs','Boat','Spare Parts','Electric Scooters'],
};

// Build flat set of legal "top > leaf" category paths.
const CATEGORY_PATHS = new Set();
for (const [top, leaves] of Object.entries(CATEGORY_TREE)) {
  for (const leaf of leaves) CATEGORY_PATHS.add(`${top} > ${leaf}`);
}

// Country master: union of every region's {code, name} pairs in the UI.
// Pairs are deduplicated by code; name is the canonical one shown by the UI.
const COUNTRY_REGIONS = {
  Popular: [
    ['US','United States'],['UK','United Kingdom'],['CA','Canada'],['RU','Russia'],['DE','Germany'],['FR','France'],
    ['MX','Mexico'],['BR','Brazil'],['ES','Spain'],['IT','Italy'],['PH','Philippines'],['AU','Australia'],
    ['PK','Pakistan'],['MY','Malaysia'],['SA','Saudi Arabia'],['NL','Netherlands'],['TH','Thailand'],['TR','Turkey'],
    ['PE','Peru'],['ID','Indonesia'],['IN','India'],['CL','Chile'],['EG','Egypt'],['KR','South Korea'],
    ['CO','Colombia'],['JP','Japan'],['VN','Vietnam'],['UA','Ukraine'],['ZA','South Africa'],['AR','Argentina'],
    ['MA','Morocco'],['BD','Bangladesh'],['AE','UAE'],['NZ','New Zealand'],
  ],
  'South America': [['BR','Brazil'],['AR','Argentina'],['CL','Chile'],['CO','Colombia'],['PE','Peru'],['EC','Ecuador'],['VE','Venezuela'],['UY','Uruguay'],['PY','Paraguay'],['BO','Bolivia']],
  Europe: [['UK','United Kingdom'],['DE','Germany'],['FR','France'],['IT','Italy'],['ES','Spain'],['NL','Netherlands'],['PL','Poland'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],['FI','Finland'],['PT','Portugal'],['GR','Greece'],['CZ','Czech Republic'],['RO','Romania'],['UA','Ukraine'],['RU','Russia'],['BE','Belgium'],['AT','Austria'],['CH','Switzerland'],['IE','Ireland'],['HU','Hungary']],
  Africa: [['ZA','South Africa'],['EG','Egypt'],['MA','Morocco'],['NG','Nigeria'],['KE','Kenya'],['GH','Ghana'],['TZ','Tanzania'],['ET','Ethiopia'],['SN','Senegal'],['DZ','Algeria']],
  'North America': [['US','United States'],['CA','Canada'],['MX','Mexico'],['GT','Guatemala'],['CU','Cuba'],['DO','Dominican Republic'],['HN','Honduras'],['PA','Panama'],['CR','Costa Rica'],['JM','Jamaica']],
  Oceania: [['AU','Australia'],['NZ','New Zealand'],['FJ','Fiji'],['PG','Papua New Guinea']],
  Asia: [['JP','Japan'],['KR','South Korea'],['IN','India'],['TH','Thailand'],['VN','Vietnam'],['MY','Malaysia'],['ID','Indonesia'],['PH','Philippines'],['SG','Singapore'],['PK','Pakistan'],['BD','Bangladesh'],['SA','Saudi Arabia'],['AE','UAE'],['TR','Turkey'],['IL','Israel'],['IQ','Iraq'],['KW','Kuwait'],['QA','Qatar'],['LK','Sri Lanka'],['MM','Myanmar'],['KH','Cambodia'],['NP','Nepal']],
};

const COUNTRY_MASTER = (() => {
  const map = new Map();
  for (const region of Object.values(COUNTRY_REGIONS)) {
    for (const [code, name] of region) {
      if (!map.has(code)) map.set(code, name);
    }
  }
  return map;
})();

function validateEnum(name, value) {
  const allowed = ALLOWED[name];
  if (!allowed) return null;
  return allowed.includes(String(value))
    ? null
    : `${name}: "${value}" is not one of [${allowed.join(', ')}]`;
}

function validateCategory(value) {
  return CATEGORY_PATHS.has(String(value))
    ? null
    : `category: "${value}" is not a known category path`;
}

function validateSelectedCountries(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return `selectedCountries: not valid JSON`;
  }
  if (!Array.isArray(parsed)) return `selectedCountries: must be a JSON array`;
  const errs = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || !item.code || !item.name) {
      errs.push(`selectedCountries: item missing code/name: ${JSON.stringify(item)}`);
      continue;
    }
    const canon = COUNTRY_MASTER.get(String(item.code));
    if (!canon) {
      errs.push(`selectedCountries: unknown country code "${item.code}"`);
    } else if (String(item.name) !== canon) {
      errs.push(`selectedCountries: code "${item.code}" expects name "${canon}", got "${item.name}"`);
    }
  }
  return errs.length === 0 ? null : errs.join('; ');
}

function validateJsonArrayShape(name, value, requiredKeys) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return `${name}: not valid JSON`;
  }
  if (!Array.isArray(parsed)) return `${name}: must be a JSON array`;
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      return `${name}: items must be objects`;
    }
    for (const key of requiredKeys) {
      if (!(key in item) || item[key] === '' || item[key] === null) {
        return `${name}: missing key "${key}" in item ${JSON.stringify(item)}`;
      }
    }
  }
  return null;
}

// Validate a single field value. Returns an error string or null.
function validateField(name, value) {
  if (value === undefined || value === null || value === '') return null;
  if (name === 'category') return validateCategory(value);
  if (name === 'selectedCountries') return validateSelectedCountries(value);
  if (name === 'deliveryPeriod') {
    const shapeErr = validateJsonArrayShape(name, value, ['quantity', 'days']);
    if (shapeErr) return shapeErr;
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    for (const item of parsed) {
      if (!/^\d+$/.test(String(item.days).trim())) {
        return `deliveryPeriod: "days" must be a plain number of days, got "${item.days}"`;
      }
    }
    return null;
  }
  if (name === 'ladderPrice') return validateJsonArrayShape(name, value, ['quantity', 'price']);
  if (ALLOWED[name]) return validateEnum(name, value);
  return null;
}

module.exports = { ALLOWED, CATEGORY_PATHS, COUNTRY_MASTER, validateField };
