// Server-side enum + structural validation for /api/submit on the
// shopify_admin mock site.
//
// Closed-set fields (radio/select/checkbox/dropdown) must match the values the
// UI actually exposes; agents who bypass the form by writing arbitrary text
// into hidden inputs or POSTing JSON directly should be rejected here. This
// module is the single source of truth for what counts as a legal value.
//
// Source-of-truth references:
//   public/products-new.html (status, weightUnit, countryOfOrigin)
//   public/products-new.js   (salesChannels, chargeTax, trackQuantity)
//   public/themes-customize.js
//     ├─ OPTIONS  (industry, businessType, brandTone, fontHeading, fontBody)
//     ├─ THEMES, COLOR_SCHEMES, HEADER_LAYOUT, PUBLISH_STATUS
//     └─ SECTION_SCHEMAS keys (legal sectionsConfig section types)
//   public/storefront-renderer.js (TEMPLATES — themeTemplate enum)

// ---- Product page closed-set enums ----
const PRODUCT_ALLOWED = {
  status: ['active', 'draft', 'archived'],
  weightUnit: ['kg', 'g', 'lb', 'oz'],
  countryOfOrigin: [
    'CN', 'US', 'JP', 'KR', 'VN', 'IN', 'DE', 'FR', 'IT', 'GB',
    'MX', 'BR', 'OTHER',
  ],
  chargeTax: ['true'],
  trackQuantity: ['true'],
};

const PRODUCT_SALES_CHANNELS = ['online_store', 'point_of_sale', 'shop', 'google_youtube'];

// ---- Theme page closed-set enums ----
const THEME_ALLOWED = {
  themeTemplate: ['classic', 'editorial'],
  industry: ['服装鞋包', '食品饮料', '家居家具', '电子数码', '美妆个护', '健康保健', '运动户外', '玩具母婴', '艺术手工', '宠物用品', '其他'],
  businessType: ['B2C 零售', 'B2B 批发', 'D2C 直销', '订阅服务', '数字商品'],
  brandTone: ['专业稳重', '活力时尚', '优雅高端', '朴实自然', '极简现代', '复古怀旧'],
  theme: ['Dawn', 'Sense', 'Refresh', 'Studio', 'Crave'],
  colorScheme: ['Light & Bright', 'Bold & Modern', 'Warm & Earthy', 'Cool & Clean', 'Dark Luxe'],
  fontHeading: ['Inter', 'Playfair Display', 'DM Serif Display', 'Bebas Neue', 'Cormorant Garamond', 'Manrope', 'Space Grotesk'],
  fontBody: ['Inter', 'Manrope', 'Lato', 'Source Sans 3', 'Nunito Sans', 'Work Sans'],
  headerLayout: ['left', 'center', 'right'],
  publishStatus: ['published', 'draft'],
  agreement: ['true'],
};

// Legal section types in sectionsConfig (must mirror public/themes-customize.js
// SECTION_SCHEMAS keys, minus 'header'/'footer' which are fixed).
const THEME_SECTION_TYPES = [
  'announcement', 'hero', 'product-list', 'featured-product',
  'image-with-text', 'multicolumn', 'rich-text', 'image-banner', 'newsletter',
];

function err(name, msg) {
  return `${name}: ${msg}`;
}

function validateEnum(allowedMap, name, value) {
  const allowed = allowedMap[name];
  if (!allowed) return null;
  return allowed.includes(String(value))
    ? null
    : err(name, `"${value}" is not one of [${allowed.join(', ')}]`);
}

function validateSalesChannels(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return err('salesChannels', 'not valid JSON');
  }
  if (!Array.isArray(parsed)) return err('salesChannels', 'must be a JSON array');
  for (const item of parsed) {
    if (!PRODUCT_SALES_CHANNELS.includes(String(item))) {
      return err('salesChannels', `unknown channel "${item}" — allowed [${PRODUCT_SALES_CHANNELS.join(', ')}]`);
    }
  }
  return null;
}

function validateVariants(value) {
  // Variants are user-supplied (Cartesian product of options); we only
  // enforce structural shape: array of {options: [{name, value}]}.
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return err('variants', 'not valid JSON');
  }
  if (!Array.isArray(parsed)) return err('variants', 'must be a JSON array');
  for (const variant of parsed) {
    if (!variant || typeof variant !== 'object') {
      return err('variants', `each variant must be an object, got ${JSON.stringify(variant)}`);
    }
    if (!Array.isArray(variant.options)) {
      return err('variants', `variant.options must be an array: ${JSON.stringify(variant)}`);
    }
    for (const opt of variant.options) {
      if (!opt || typeof opt !== 'object' || !opt.name || opt.value === undefined || opt.value === null) {
        return err('variants', `option must have non-empty name and value: ${JSON.stringify(opt)}`);
      }
    }
  }
  return null;
}

function validateJsonArrayOfStrings(name, value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return err(name, 'not valid JSON');
  }
  if (!Array.isArray(parsed)) return err(name, 'must be a JSON array');
  for (const item of parsed) {
    if (typeof item !== 'string' || !item) {
      return err(name, `items must be non-empty strings: ${JSON.stringify(item)}`);
    }
  }
  return null;
}

function validateMenuItems(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return err('menuItems', 'not valid JSON');
  }
  if (!Array.isArray(parsed)) return err('menuItems', 'must be a JSON array');
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof item.label !== 'string' || !item.label) {
      return err('menuItems', `each item must be {label: string}: ${JSON.stringify(item)}`);
    }
  }
  return null;
}

function validateProducts(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return err('products', 'not valid JSON');
  }
  if (!Array.isArray(parsed)) return err('products', 'must be a JSON array');
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      return err('products', `each item must be an object: ${JSON.stringify(item)}`);
    }
    if (typeof item.title !== 'string' || !item.title) {
      return err('products', `item missing title: ${JSON.stringify(item)}`);
    }
  }
  return null;
}

function validateSectionsConfig(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return err('sectionsConfig', 'not valid JSON');
  }
  if (!Array.isArray(parsed)) return err('sectionsConfig', 'must be a JSON array');
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      return err('sectionsConfig', `each item must be an object: ${JSON.stringify(item)}`);
    }
    const type = String(item.type || '').replace(/_\d+$/, '');
    if (!THEME_SECTION_TYPES.includes(type)) {
      return err('sectionsConfig', `unknown section type "${item.type}" — allowed [${THEME_SECTION_TYPES.join(', ')}]`);
    }
  }
  return null;
}

// Validate a single field value for a given page. Returns an error string or null.
function validateField(page, name, value) {
  if (value === undefined || value === null || value === '') return null;
  if (page === 'product') {
    if (PRODUCT_ALLOWED[name]) return validateEnum(PRODUCT_ALLOWED, name, value);
    if (name === 'salesChannels') return validateSalesChannels(value);
    if (name === 'variants') return validateVariants(value);
    if (name === 'collections' || name === 'tags') return validateJsonArrayOfStrings(name, value);
    return null;
  }
  if (page === 'theme') {
    if (THEME_ALLOWED[name]) return validateEnum(THEME_ALLOWED, name, value);
    if (name === 'menuItems') return validateMenuItems(value);
    if (name === 'products') return validateProducts(value);
    if (name === 'sectionsConfig') return validateSectionsConfig(value);
    return null;
  }
  return null;
}

module.exports = {
  PRODUCT_ALLOWED,
  PRODUCT_SALES_CHANNELS,
  THEME_ALLOWED,
  THEME_SECTION_TYPES,
  validateField,
};
