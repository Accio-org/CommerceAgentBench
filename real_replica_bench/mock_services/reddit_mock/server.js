const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cookieParser());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// ============ Auth Configuration ============
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dDJfN3g5a2YycW0zZHc.session_v2_abc123def456';
const SESSION_COOKIE_NAME = 'reddit_session';
const TOKEN_COOKIE_NAME = 'token_v2';
const LOID_COOKIE_NAME = 'loid';
const CSRF_COOKIE_NAME = 'csrf_token';
const BROWSER_READY_COOKIE_NAME = 'reddit_browser_ready';
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || '';
const ALLOW_CLI = process.env.MOCK_ALLOW_CLI === '1';
const CLI_TOKEN = process.env.MOCK_CLI_TOKEN || 'local-mock-token';
const browserReadyTokens = new Set();

// The actual auth requires BOTH reddit_session AND token_v2 to be correct
const VALID_SESSION = 'k4m8x2pq9v.2.1778917909.Z0FBQUFBQnB5bEpmX0NhWVR3';
const VALID_TOKEN = AUTH_TOKEN;

// Decoy cookies (set alongside real ones but not required for auth)
const DECOY_COOKIES = {
  'recent_srs': 't5_2qh1i%2Ct5_2t1qf%2Ct5_aqipas',
  'loid': '00000000277t4x8jf6.2.1769756023529.Z0FBQUFBQnB5bEpf',
  'csv': '2',
  'edgebucket': 'general_bucket_v1',
  'eu_cookie_v2': '3',
  'pc': 'sg',
  'csrf_token': 'a9f3b7c2d1e8f4a6b5c3d2e1f0a9b8c7'
};

// ============ Access Logging ============
const accessLog = [];
const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(mozilla|chrome|chromium|safari|firefox|edg|headlesschrome)/i;

function safeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function hasValidVerifierToken(req) {
  if (!VERIFIER_TOKEN) return true;
  return safeEquals(req.get('x-mock-verifier-token') || '', VERIFIER_TOKEN);
}

function extractBearerToken(req) {
  const raw = req.get('authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasValidCliToken(req) {
  if (!ALLOW_CLI) return false;
  return safeEquals(extractBearerToken(req), CLI_TOKEN);
}

function requireCliClient(req, res, next) {
  if (!hasValidCliToken(req)) {
    accessLog.push({
      path: req.path,
      timestamp: Date.now(),
      method: req.method,
      blocked: true,
      reason: 'cli_token_required',
      userAgent: String(req.get('user-agent') || '').slice(0, 160),
    });
    return res.status(403).json({
      error: 'cli_token_required',
      message: 'Provide Authorization: Bearer <MOCK_CLI_TOKEN> for /api/cli/* endpoints.',
    });
  }
  return next();
}

function logCliAccess(req) {
  accessLog.push({
    path: req.path,
    timestamp: Date.now(),
    method: req.method,
    event: 'cli_access_valid',
    userAgent: String(req.get('user-agent') || '').slice(0, 160),
  });
}

function requireVerifierToken(req, res, next) {
  if (hasValidVerifierToken(req)) return next();
  accessLog.push({
    path: req.path,
    timestamp: Date.now(),
    method: req.method,
    blocked: true,
    reason: 'verifier_only',
    userAgent: String(req.get('user-agent') || '').slice(0, 160),
  });
  return res.status(403).json({ error: 'verifier_only', message: 'This endpoint is available only to the benchmark verifier.' });
}

function classifyBrowserClient(req) {
  const ua = req.get('user-agent') || '';
  const accept = req.get('accept') || '';
  const secFetchDest = req.get('sec-fetch-dest') || '';
  if (!ua) return 'missing user-agent';
  if (NON_BROWSER_UA.test(ua)) return 'programmatic user-agent';
  if (!BROWSER_UA.test(ua)) return 'non-browser user-agent';
  if (req.method === 'GET' && !accept.includes('text/html') && secFetchDest !== 'document') {
    return 'non-browser navigation headers';
  }
  return '';
}

function renderBrowserRequiredPage(reason) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Browser Required</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f7f8;color:#1a1a1b;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{max-width:560px;background:#fff;border:1px solid #dfe1e5;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 12px}.muted{color:#57606a;font-size:14px}
code{background:#f1f3f5;border-radius:4px;padding:2px 4px}
</style></head><body><main class="card"><h1>Browser access required</h1><p>This benchmark forum only serves protected pages to a real browser session. Do not use <code>curl</code>, web fetch, or raw HTTP scraping; open the URL in the browser and navigate the UI.</p><p class="muted">Reason: ${reason}</p></main></body></html>`;
}

function denyNonBrowser(req, res, reason) {
  accessLog.push({
    path: req.path,
    timestamp: Date.now(),
    method: req.method,
    blocked: true,
    reason,
    userAgent: String(req.get('user-agent') || '').slice(0, 160),
  });
  return res.status(403).type('text/plain').send('Access Denied: automated HTTP clients, including curl and web fetch, are not permitted to retrieve this protected page. Please open the URL in a browser.\n');
}

function requireBrowserClient(req, res, next) {
  if (ALLOW_CLI && req.path.startsWith('/api/cli/')) return next();
  if (req.path === '/health' || req.path === '/api/access-log' || req.path.startsWith('/images/')) return next();
  if (req.path === '/favicon.ico') return res.status(204).end();
  const reason = classifyBrowserClient(req);
  if (reason) return denyNonBrowser(req, res, reason);
  return next();
}

function isAuthenticated(req) {
  const session = req.cookies[SESSION_COOKIE_NAME];
  const token = req.cookies[TOKEN_COOKIE_NAME];
  return session === VALID_SESSION && token === VALID_TOKEN;
}

function hasBrowserReadyCookie(req) {
  const token = req.cookies[BROWSER_READY_COOKIE_NAME];
  return !!(token && browserReadyTokens.has(token));
}

// ============ Content Data ============
const SUBREDDIT = {
  name: 'CrossBorderCommerce',
  description: 'A community for cross-border e-commerce sellers, sourcing agents, and logistics professionals. Share strategies, supplier reviews, and lessons learned.',
  members: '89,432',
  online: '1,247'
};

const USERS = {
  'ShenzhenSourcer': { avatar: '/images/avatar_1.png', karma: '12,847', cake_day: 'Mar 15, 2021' },
  'FBA_MasterMind': { avatar: '/images/avatar_2.png', karma: '8,293', cake_day: 'Jul 2, 2022' },
  'DropshipDebunker': { avatar: '/images/avatar_3.png', karma: '5,671', cake_day: 'Nov 18, 2022' },
  'QualityFirst_QC': { avatar: '/images/avatar_4.png', karma: '15,102', cake_day: 'Jan 9, 2020' },
  'LogisticsLara': { avatar: '/images/avatar_5.png', karma: '6,934', cake_day: 'Sep 23, 2023' }
};

const POSTS = [
  {
    id: 'post_1a7x9k',
    title: 'After 3 years sourcing electronics from Shenzhen, here are my hard-learned lessons on finding reliable suppliers',
    author: 'ShenzhenSourcer',
    score: 847,
    comments_count: 156,
    created: '2 days ago',
    type: 'text',
    flair: 'Guide',
    content: `I've been sourcing consumer electronics (Bluetooth speakers, TWS earbuds, LED strips) from Shenzhen for 3 years now, shipping primarily to EU and US markets. Here's what I wish someone told me on day one:

**1. Alibaba "Gold Supplier" badges mean almost nothing**
Don't trust badges. I've had Gold Suppliers with 10+ years send me complete garbage. Instead, look at their export history on customs data sites, check if they have their own factory (ask for video tours), and always order samples before committing.

**2. The 30/70 payment split is your best friend**
Never pay 100% upfront. Standard is 30% deposit, 70% before shipping after inspection photos. If a supplier refuses this, walk away. I lost $14,000 on my second order because I paid 100% to a "trusted" supplier who then ghosted me.

**3. Third-party QC inspection is non-negotiable**
Budget $200-400 per inspection. I use QIMA for larger orders and a local freelance inspector (found on LinkedIn) for smaller ones. The inspector should check:
- AQL 2.5 for critical defects
- AQL 4.0 for major defects
- Full function test on 20% of units
- Drop test on 3 random units
- Packaging integrity check

**4. Shipping: Don't use the supplier's freight forwarder**
They'll mark up 30-50%. Get your own. I use Flexport for FCL shipments and Freightos for LCL. For small parcels under 100kg, Yanwen or 4PX are solid choices.

**5. Negotiate MOQ down by offering longer-term commitment**
Most suppliers will cut MOQ by 50% if you commit to 3 orders over 6 months. Get it in writing (WeChat messages count as contracts in Chinese law).

**6. Always have a backup supplier**
I maintain relationships with 2-3 suppliers per product category. When my primary earbuds supplier had a factory fire in 2024, I pivoted to my backup within 48 hours and barely missed a shipment window.

Happy to answer questions. Also built a spreadsheet tracker for supplier evaluation if anyone wants it.`,
    image: null
  },
  {
    id: 'post_2b8y0l',
    title: 'Our warehouse automation reduced shipping errors by 94% - here\'s the exact setup',
    author: 'FBA_MasterMind',
    score: 623,
    comments_count: 89,
    created: '5 days ago',
    type: 'image',
    flair: 'Case Study',
    content: `We run a 3PL warehouse handling ~2000 orders/day for cross-border sellers. Last year our error rate was 6.2% (wrong item, wrong quantity, missing accessories). After implementing this system, we're down to 0.37%.

**The Setup:**
- Barcode scanning at every touchpoint (receive, pick, pack, ship)
- Weight verification: each SKU has an expected weight range. If the packed box is outside ±50g, it gets flagged for manual review
- Photo documentation: camera auto-captures each box before sealing
- Zone picking with light-directed system

**Cost:** About $45K total investment for a 5000 sqft space. ROI was achieved in 4 months through reduced reshipping costs and customer complaints.

The biggest win wasn't the tech — it was the process change. We moved from "batch picking" to "wave picking" with dedicated packers per zone. That alone cut errors by 60% before we even added the barcode scanning.`,
    image: '/images/post_warehouse.png'
  },
  {
    id: 'post_3c9z1m',
    title: 'Conversion rate went from 2.1% to 7.8% after rebuilding our Alibaba product listings - data inside',
    author: 'DropshipDebunker',
    score: 412,
    comments_count: 67,
    created: '1 week ago',
    type: 'image',
    flair: 'Data',
    content: `I manage listings for 12 cross-border stores (mix of Alibaba international, Amazon, and independent Shopify sites). We did a complete overhaul of our Alibaba listings in January and the results are significant.

**What we changed:**
1. Title format: moved from keyword-stuffed to benefit-first ("Waterproof Bluetooth Speaker for Outdoor Adventures | 24H Battery | IPX7" vs old "Speaker Bluetooth Wireless Portable Waterproof IPX7 Outdoor...")
2. Main image: switched to lifestyle shots (product in use) instead of white background catalog photos
3. Added video (30-60 seconds showing the product being used)
4. Rewrote descriptions to focus on use cases, not just specs
5. Added comparison tables against competitors (without naming them)
6. Pricing: moved to tiered pricing with clear volume discounts visible in the listing

**Results (Jan-Apr 2026):**
- Inquiry rate: +340% (from 12/week to 53/week)
- Conversion to sample order: +180%
- Average order value: +45% (buyers choosing higher tiers)
- Return rate: dropped from 8.2% to 3.1% (better expectations from improved descriptions)

The biggest single factor was the video. Listings with video had 4.2x higher inquiry rates than those without.`,
    image: '/images/post_analytics.png'
  },
  {
    id: 'post_4d0a2n',
    title: 'PSA: New EU packaging regulation (PPWR) takes effect July 2026 - here\'s what cross-border sellers need to know',
    author: 'QualityFirst_QC',
    score: 1203,
    comments_count: 234,
    created: '3 days ago',
    type: 'text',
    flair: 'Important',
    content: `The EU's Packaging and Packaging Waste Regulation (PPWR) formally takes effect July 1, 2026. If you sell into the EU, this affects you NOW because you need to be compliant before goods arrive.

**Key requirements:**
1. **All packaging must be recyclable** - no more mixed-material packaging (like plastic-coated cardboard). If your supplier ships in plastic blister packs, you need to switch.
2. **Minimum recycled content**: 35% for plastic packaging by weight
3. **Packaging minimization**: empty space in shipping boxes cannot exceed 40% of total volume
4. **Digital Product Passport**: QR code on packaging linking to material composition data
5. **Extended Producer Responsibility (EPR)**: you must register with the EPR scheme in each EU country you sell to

**What you need to do RIGHT NOW:**
- Audit your current packaging materials
- Ask suppliers for material composition certificates
- Register for EPR in your target markets (Germany/France/Spain have the strictest enforcement)
- Switch to mono-material packaging where possible
- Budget for the Digital Product Passport system (several SaaS options available, ~€200/month)

**Penalties:** Up to €100,000 per violation or 4% of annual EU turnover, whichever is higher.

I've seen several sellers on here ignore the German VerpackG already. The EU-wide regulation will be much more strictly enforced. Don't get caught.`,
    image: null
  },
  {
    id: 'post_5e1b3o',
    title: 'Comparing 5 freight forwarders for China→US routes: prices, transit times, and reliability (Q1 2026 data)',
    author: 'LogisticsLara',
    score: 567,
    comments_count: 98,
    created: '4 days ago',
    type: 'text',
    flair: 'Comparison',
    content: `I ship 8-12 FCL containers per month from various Chinese ports to US West Coast and East Coast. Here's my Q1 2026 comparison of the forwarders I've used:

**1. Flexport**
- Price: $4,200-4,800/40ft FCL (Shenzhen→LA)
- Transit: 14-18 days
- Reliability: 92% on-time
- Pros: Great dashboard, proactive communication, handles customs brokerage
- Cons: Most expensive option, slow response on weekends

**2. Freightos/Ship4wd**
- Price: $3,600-4,100/40ft FCL
- Transit: 16-22 days
- Reliability: 85% on-time
- Pros: Price comparison tool, good for spot bookings
- Cons: Customer service is hit or miss, had 2 containers delayed 3+ weeks in Q1

**3. Zencargo**
- Price: $3,900-4,400/40ft FCL
- Transit: 15-19 days
- Reliability: 89% on-time
- Pros: Carbon tracking, good EU routing too
- Cons: Smaller network in Asia, limited warehouse options

**4. Forceget (力拓供应链)**
- Price: $3,100-3,500/40ft FCL
- Transit: 15-20 days
- Reliability: 88% on-time
- Pros: Cheapest option, strong China domestic logistics
- Cons: English support limited, documentation sometimes needs double-checking

**5. Twill (Maersk digital)**
- Price: $3,800-4,300/40ft FCL
- Transit: 14-17 days
- Reliability: 94% on-time
- Pros: Maersk network reliability, best transit times
- Cons: Rigid booking system, change fees are brutal ($500+ per amendment)

**My recommendation:** Flexport for high-value goods where you need reliability. Forceget for cost-sensitive bulk shipments. Twill when transit time matters most.

Note: Prices are all-in (ocean freight + origin charges + destination charges) excluding duties/taxes. Your mileage may vary based on volume commitments.`,
    image: null
  },
  {
    id: 'post_6f2c4p',
    title: 'I spent $8,000 on QC inspections last year and it saved me over $120,000 in returns and chargebacks',
    author: 'QualityFirst_QC',
    score: 934,
    comments_count: 178,
    created: '1 week ago',
    type: 'image',
    flair: 'Guide',
    content: `People always ask me if QC inspections are "worth it" for smaller orders. Let me break down my actual numbers from 2025.

**My product categories:** Home electronics, kitchen gadgets, phone accessories
**Total orders in 2025:** 47 orders across 8 suppliers
**Total inspection cost:** $8,247 (mix of QIMA, V-Trust, and freelance inspectors)

**Inspections caught:**
- 6 orders with critical defects (would have been 100% customer returns)
- 11 orders with major defects requiring rework before shipping
- 3 orders where supplier substituted cheaper materials

**Cost of those defects if shipped:**
- 6 critical: ~$67,000 in product cost + return shipping + marketplace penalties
- 11 major: ~$42,000 in partial returns and negative reviews (estimated 15% return rate on defective batches)
- 3 material substitutions: ~$18,000 in potential warranty claims

**Total saved: ~$127,000 vs $8,247 invested = 15.4x ROI**

**My inspection protocol:**
1. Pre-production inspection (for new suppliers only): check raw materials and production capability
2. During-production inspection (at 30% completion): catch issues before full batch is ruined
3. Pre-shipment inspection (EVERY order): final AQL check before shipping

**AQL standards I use:**
- Critical defects (safety issues): AQL 0 (zero tolerance)
- Major defects (function issues): AQL 2.5
- Minor defects (cosmetic): AQL 4.0

For orders under $5,000, I use a freelance inspector at $180-250/day. For orders over $5,000, I use QIMA or V-Trust at $300-400/inspection.

The math is simple: if your defect rate without inspection is above 3%, inspections pay for themselves immediately.`,
    image: '/images/post_qc.png'
  }
];

const COMMENTS = {
  'post_1a7x9k': [
    { author: 'FBA_MasterMind', score: 234, content: 'The 30/70 payment advice is gold. I\'d also add: use Alibaba Trade Assurance for your first 2-3 orders with a new supplier. Yes, you pay a small premium, but the dispute resolution is worth it until you build trust.', created: '2 days ago' },
    { author: 'LogisticsLara', score: 156, content: 'On the freight forwarder point — I\'d add that you should NEVER let the supplier handle export customs declaration either. I\'ve seen suppliers undervalue declarations to save on export taxes, which then causes problems at destination customs.', created: '1 day ago' },
    { author: 'QualityFirst_QC', score: 189, content: 'Regarding QC inspection: I\'d bump your recommendation from 20% function test to 100% for electronics. Electronic items have higher defect rates than textiles/plastics. The extra cost is minimal compared to returns.', created: '2 days ago' },
    { author: 'DropshipDebunker', score: 98, content: 'Can confirm the backup supplier strategy. Had my main silicone products supplier shut down during COVID with zero notice. Took me 3 months to find and qualify a new one. Now I always keep a tested backup.', created: '1 day ago' }
  ],
  'post_4d0a2n': [
    { author: 'ShenzhenSourcer', score: 312, content: 'Thanks for this. Do you know if the 40% empty space rule applies to the individual product packaging or just the shipping carton? Some of our products have irregular shapes that inherently create void space.', created: '3 days ago' },
    { author: 'QualityFirst_QC', score: 287, content: 'It applies to both, but enforcement will initially focus on shipping/transport packaging. Individual product packaging enforcement starts 2027. However, I\'d recommend getting compliant now while suppliers can still adjust tooling. Source: I attended the EU Commission briefing last month.', created: '3 days ago' },
    { author: 'LogisticsLara', score: 145, content: 'For anyone worried about the EPR registration — there are services like Lizenzero (Germany) and Citeo (France) that handle multi-country registration. Budget about €500-2000/year depending on your packaging volume.', created: '2 days ago' },
    { author: 'FBA_MasterMind', score: 203, content: 'The Digital Product Passport requirement is going to be a nightmare for sellers with 100+ SKUs. Each SKU needs its own QR code linking to material data. Anyone found a good bulk solution for this?', created: '2 days ago' }
  ],
  'post_5e1b3o': [
    { author: 'ShenzhenSourcer', score: 167, content: 'Great comparison. I\'d add that for DDP (Delivered Duty Paid) shipments, Flexport is significantly better because their customs brokerage is included. With cheaper forwarders, you often get surprise duty invoices or clearance delays.', created: '4 days ago' },
    { author: 'QualityFirst_QC', score: 134, content: 'Has anyone used Forceget for LCL shipments? Their FCL pricing is great but I mainly ship 2-5 CBM per order which doesn\'t justify a full container.', created: '3 days ago' },
    { author: 'LogisticsLara', score: 98, content: 'Good question — yes, Forceget does LCL but their consolidation warehouse is in Yiwu, not Shenzhen. If your goods are in South China, there\'s an extra domestic leg that adds 3-5 days and ~$0.5/kg.', created: '3 days ago' }
  ]
};

// ============ Shared HTML Components ============

function sharedCSS() {
  return `
:root {
  --bg-page: #dae0e6; --bg-card: #ffffff; --bg-card-hover: #fafafa;
  --bg-header: #ffffff; --bg-input: #f6f7f8; --bg-input-focus: #ffffff;
  --bg-hover: rgba(0,0,0,0.04); --bg-active: rgba(255,69,0,0.08);
  --text-primary: #1a1a1b; --text-secondary: #787c7e; --text-link: #0079d3;
  --text-title: #1a1a1b; --text-meta: #787c7e;
  --border-color: #ccc; --border-light: #edeff1;
  --primary: #ff4500; --primary-hover: #e03d00; --primary-bg: rgba(255,69,0,0.08);
  --upvote: #ff4500; --downvote: #7193ff;
  --flair-bg: #edeff1; --flair-text: #1a1a1b;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 20px; --radius-full: 9999px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); background: var(--bg-page); color: var(--text-primary); min-height: 100vh; }
a { text-decoration: none; color: inherit; }
button { font-family: inherit; }
`;
}

function sharedHeader(searchQuery) {
  const searchVal = searchQuery ? ` value="${searchQuery}"` : '';
  return `
<header class="site-header">
  <nav class="header-nav">
    <a class="header-logo" href="/">
      <svg viewBox="0 0 20 20" width="32" height="32" fill="#ff4500" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="10" fill="#ff4500"/>
        <path d="M16.67 10a1.46 1.46 0 00-2.47-1 7.12 7.12 0 00-3.85-1.23l.65-3.08 2.13.45a1.04 1.04 0 102.09 0 1.04 1.04 0 00-1.98-.45l-2.38-.5a.26.26 0 00-.3.2l-.73 3.44a7.14 7.14 0 00-3.9 1.23 1.46 1.46 0 10-1.61 2.39 2.87 2.87 0 000 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 000-.44 1.46 1.46 0 00.69-1.35zM7.17 11.04a1.04 1.04 0 111.04 1.04 1.04 1.04 0 01-1.04-1.04zm5.81 2.75a3.58 3.58 0 01-2.98 1 3.58 3.58 0 01-2.98-1 .18.18 0 01.26-.26 3.2 3.2 0 002.72.87 3.2 3.2 0 002.72-.87.18.18 0 11.26.26zm-.21-1.71a1.04 1.04 0 111.04-1.04 1.04 1.04 0 01-1.04 1.04z" fill="#fff"/>
      </svg>
      <span class="logo-text">reddit</span>
    </a>
    <div class="header-search">
      <form action="/search" method="GET">
        <div class="search-wrapper">
          <svg class="search-icon" viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path d="M15.59 13.91l2.78 2.69a1.06 1.06 0 11-1.47 1.52l-2.82-2.73a7.66 7.66 0 111.51-1.48zM9.14 15.1a5.93 5.93 0 100-11.86 5.93 5.93 0 000 11.86z"/></svg>
          <input type="text" name="q"${searchVal} placeholder="Search Reddit" autocomplete="off">
        </div>
      </form>
    </div>
    <div class="header-actions">
      <div class="user-menu">
        <img src="/images/avatar_1.png" alt="user" class="user-avatar">
        <span class="username">TestUser_2024</span>
      </div>
    </div>
  </nav>
</header>`;
}

function headerCSS() {
  return `
.site-header { background: var(--bg-header); border-bottom: 1px solid var(--border-color); position: sticky; top: 0; z-index: 100; }
.header-nav { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 48px; max-width: 1400px; margin: 0 auto; }
.header-logo { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.logo-text { font-size: 1.2rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; }
.header-search { flex: 1; max-width: 600px; }
.search-wrapper { display: flex; align-items: center; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 0 12px; transition: all 0.2s; }
.search-wrapper:focus-within { background: var(--bg-input-focus); border-color: var(--text-secondary); }
.search-icon { color: var(--text-secondary); flex-shrink: 0; }
.search-wrapper input { background: none; border: none; color: var(--text-primary); font-size: 14px; padding: 8px; width: 100%; outline: none; }
.search-wrapper input::placeholder { color: var(--text-secondary); }
.header-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.user-menu { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; border: 1px solid transparent; }
.user-menu:hover { border-color: var(--border-color); }
.user-avatar { width: 28px; height: 28px; border-radius: 50%; }
.username { font-size: 12px; color: var(--text-primary); font-weight: 500; }
`;
}

// ============ HTML Templates ============

function renderBlockedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>reddit - Pair the name with the flame</title>
<style>
:root {
  --color-neutral-background: #ffffff;
  --color-neutral-background-weak: #f6f7f8;
  --color-neutral-content-strong: #1a1a1b;
  --color-neutral-content-weak: #7c7c7c;
  --color-primary: #ff4500;
  --color-primary-hover: #e03d00;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font-sans); background: var(--color-neutral-background-weak); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.container { text-align: center; max-width: 480px; padding: 2rem; }
.shield-icon { width: 120px; height: 120px; margin-bottom: 1.5rem; }
.title { font-size: 1.5rem; font-weight: 700; color: var(--color-neutral-content-strong); margin-bottom: 1rem; }
.description { font-size: 1rem; color: var(--color-neutral-content-weak); line-height: 1.5; margin-bottom: 1.5rem; }
.buttons { display: flex; gap: 1rem; justify-content: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem; border-radius: 2rem; font-size: 0.875rem; font-weight: 700; text-decoration: none; cursor: pointer; border: none; }
.btn-primary { background: var(--color-primary); color: white; }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-secondary { background: transparent; color: var(--color-primary); border: 1px solid var(--color-primary); }
</style>
</head>
<body>
<div class="container">
  <svg class="shield-icon" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="60" cy="60" r="56" stroke="#ff4500" stroke-width="4" fill="#fff5f0"/>
    <path d="M60 25L30 40v20c0 22 13 38 30 45 17-7 30-23 30-45V40L60 25z" fill="#ff4500" opacity="0.15" stroke="#ff4500" stroke-width="2"/>
    <path d="M52 60l6 6 12-12" stroke="#ff4500" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <div class="title">You've been blocked by network security.</div>
  <div class="description">
    To continue, log in to your Reddit account or use your developer token.<br><br>
    If you think you've been blocked by mistake, file a ticket below and we'll look into it.
  </div>
  <div class="buttons">
    <a class="btn btn-primary" href="/login">Log in</a>
    <a class="btn btn-secondary" href="#">File a ticket</a>
  </div>
</div>
</body>
</html>`;
}

function renderSubredditPage(posts) {
  const postCards = posts.map(post => {
    const user = USERS[post.author];
    const imageHtml = post.image ? `<div class="post-thumbnail"><img src="${post.image}" alt="${post.title}"></div>` : '';
    const contentPreview = post.content.substring(0, 200) + '...';
    return `
    <article class="post-card" onclick="window.location='/r/CrossBorderCommerce/comments/${post.id}'">
      <div class="vote-col">
        <button class="vote-btn up" aria-label="upvote">▲</button>
        <span class="vote-score">${post.score}</span>
        <button class="vote-btn down" aria-label="downvote">▼</button>
      </div>
      <div class="post-main">
        <div class="post-meta">
          <img class="meta-avatar" src="${user.avatar}" alt="">
          <a href="/r/CrossBorderCommerce" class="meta-sub">r/CrossBorderCommerce</a>
          <span class="meta-dot">•</span>
          <span>Posted by <a href="/user/${post.author}/posts" class="meta-author">u/${post.author}</a></span>
          <span class="meta-dot">•</span>
          <span>${post.created}</span>
          <span class="post-flair">${post.flair}</span>
        </div>
        <h3 class="post-title"><a href="/r/CrossBorderCommerce/comments/${post.id}">${post.title}</a></h3>
        ${imageHtml}
        <p class="post-preview">${contentPreview}</p>
        <div class="post-actions">
          <button class="action-btn">💬 ${post.comments_count} Comments</button>
          <button class="action-btn">•••</button>
        </div>
      </div>
    </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>r/CrossBorderCommerce</title>
<style>
${sharedCSS()}
${headerCSS()}
.page-layout { max-width: 1200px; margin: 16px auto; display: grid; grid-template-columns: minmax(0,1fr) 312px; gap: 24px; padding: 0 24px; }
.feed { display: flex; flex-direction: column; }
.feed-sort { display: flex; align-items: center; gap: 8px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 8px 12px; margin-bottom: 12px; }
.post-card { display: flex; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s; }
.post-card:hover { border-color: var(--text-secondary); }
.vote-col { display: flex; flex-direction: column; align-items: center; padding: 8px 4px; min-width: 40px; background: rgba(0,0,0,0.1); border-radius: var(--radius-md) 0 0 var(--radius-md); }
.vote-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; font-size: 14px; line-height: 1; }
.vote-btn.up:hover { color: var(--upvote); }
.vote-btn.down:hover { color: var(--downvote); }
.vote-score { font-size: 12px; font-weight: 700; color: var(--text-primary); margin: 2px 0; }
.post-main { flex: 1; padding: 8px 12px; min-width: 0; }
.post-meta { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-meta); flex-wrap: wrap; margin-bottom: 4px; }
.meta-avatar { width: 20px; height: 20px; border-radius: 50%; }
.meta-sub { font-weight: 700; color: var(--text-primary); }
.meta-sub:hover { text-decoration: underline; }
.meta-author:hover { text-decoration: underline; }
.meta-dot { margin: 0 2px; }
.post-flair { background: var(--flair-bg); color: var(--flair-text); font-size: 11px; font-weight: 500; padding: 1px 8px; border-radius: var(--radius-full); margin-left: 4px; }
.post-title { font-size: 18px; font-weight: 500; line-height: 1.3; margin: 4px 0 6px; }
.post-title a { color: var(--text-title); }
.post-title a:hover { color: var(--primary); }
.post-thumbnail { margin: 8px 0; border-radius: var(--radius-sm); overflow: hidden; max-height: 350px; }
.post-thumbnail img { width: 100%; height: auto; object-fit: cover; max-height: 350px; }
.post-preview { font-size: 13px; color: var(--text-secondary); line-height: 1.4; max-height: 2.8em; overflow: hidden; margin-bottom: 4px; }
.post-actions { display: flex; gap: 2px; margin-top: 4px; }
.action-btn { background: none; border: none; color: var(--text-secondary); font-size: 12px; font-weight: 700; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; }
.action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.sidebar { position: sticky; top: 64px; height: fit-content; }
.sidebar-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; margin-bottom: 16px; }
.sidebar-banner { height: 80px; background: linear-gradient(135deg, #ff4500 0%, #ff6b35 100%); }
.sidebar-body { padding: 12px 16px; }
.sidebar-sub-header { display: flex; align-items: center; gap: 8px; margin-top: -20px; margin-bottom: 8px; }
.sidebar-sub-icon { width: 54px; height: 54px; border-radius: 50%; border: 4px solid var(--bg-card); }
.sidebar-sub-name { font-size: 16px; font-weight: 700; }
.sidebar-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.4; margin: 8px 0; }
.sidebar-stats { display: flex; gap: 24px; padding: 12px 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); margin: 8px 0; }
.stat-item { text-align: left; }
.stat-num { display: block; font-size: 16px; font-weight: 700; color: var(--text-primary); }
.stat-label { font-size: 12px; color: var(--text-secondary); }
.join-btn { width: 100%; padding: 8px; border: none; border-radius: var(--radius-full); background: var(--primary); color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 8px; }
.join-btn:hover { background: var(--primary-hover); }
.rules-list { list-style: none; }
.rules-list li { font-size: 13px; color: var(--text-secondary); padding: 8px 0; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px; }
.rules-list li:last-child { border: none; }
.rule-num { color: var(--text-primary); font-weight: 700; min-width: 16px; }
</style>
</head>
<body>
${sharedHeader('')}
<div class="page-layout">
  <div class="feed">
    ${postCards}
  </div>
  <aside class="sidebar">
    <div class="sidebar-card">
      <div class="sidebar-banner"></div>
      <div class="sidebar-body">
        <div class="sidebar-sub-header">
          <img class="sidebar-sub-icon" src="/images/subreddit_icon.png" alt="">
          <span class="sidebar-sub-name">r/CrossBorderCommerce</span>
        </div>
        <p class="sidebar-desc">${SUBREDDIT.description}</p>
        <div class="sidebar-stats">
          <div class="stat-item"><span class="stat-num">${SUBREDDIT.members}</span><span class="stat-label">Members</span></div>
          <div class="stat-item"><span class="stat-num">${SUBREDDIT.online}</span><span class="stat-label">Online</span></div>
        </div>
        <button class="join-btn">Joined ✓</button>
      </div>
    </div>
    <div class="sidebar-card">
      <div class="sidebar-body">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">Community Rules</h3>
        <ol class="rules-list">
          <li><span class="rule-num">1</span>No self-promotion or affiliate links</li>
          <li><span class="rule-num">2</span>Include data/sources for claims</li>
          <li><span class="rule-num">3</span>No supplier doxxing without evidence</li>
          <li><span class="rule-num">4</span>Search before asking common questions</li>
          <li><span class="rule-num">5</span>Flair your posts appropriately</li>
        </ol>
      </div>
    </div>
  </aside>
</div>
</body>
</html>`;
}

function renderPostPage(post, comments) {
  const user = USERS[post.author];
  const contentHtml = post.content.replace(/\n\n/g, '</p><p>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n- /g, '<br>• ');
  const imageHtml = post.image ? `<div class="post-image"><img src="${post.image}" alt="${post.title}"></div>` : '';

  const commentsHtml = (comments || []).map(c => {
    const cUser = USERS[c.author];
    return `
    <div class="comment" data-score="${c.score}" data-time="${c.created}">
      <div class="comment-vote">
        <button class="vote-btn up">▲</button>
        <button class="vote-btn down">▼</button>
      </div>
      <div class="comment-main">
        <div class="comment-header">
          <img class="comment-avatar" src="${cUser.avatar}" alt="">
          <a class="comment-author" href="/user/${c.author}/posts">u/${c.author}</a>
          <span class="comment-sep">•</span>
          <span class="comment-score">${c.score} points</span>
          <span class="comment-sep">•</span>
          <span class="comment-time">${c.created}</span>
        </div>
        <div class="comment-body">${c.content}</div>
        <div class="comment-actions">
        </div>
      </div>
    </div>`;
  }).join('');

  const relatedPosts = POSTS.filter(p => p.id !== post.id).slice(0, 4).map(p => {
    const rUser = USERS[p.author];
    return `
    <div class="related-item">
      <a href="/r/CrossBorderCommerce/comments/${p.id}" class="related-link">${p.title.length > 70 ? p.title.substring(0, 70) + '...' : p.title}</a>
      <span class="related-stats">▲ ${p.score} • 💬 ${p.comments_count}</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${post.title} : CrossBorderCommerce</title>
<style>
${sharedCSS()}
${headerCSS()}
.breadcrumb { max-width: 1200px; margin: 8px auto; padding: 0 24px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.breadcrumb a { color: var(--text-link); }
.breadcrumb a:hover { text-decoration: underline; }
.page-layout { max-width: 1200px; margin: 8px auto; display: grid; grid-template-columns: minmax(0,1fr) 312px; gap: 24px; padding: 0 24px; }
.main-col { min-width: 0; }
.post-full { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 16px; }
.post-header { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-meta); margin-bottom: 8px; flex-wrap: wrap; }
.post-header .meta-avatar { width: 20px; height: 20px; border-radius: 50%; }
.post-header .meta-sub { font-weight: 700; color: var(--text-primary); }
.post-header .meta-sub:hover { text-decoration: underline; }
.post-header .author-link { color: var(--text-link); }
.post-header .author-link:hover { text-decoration: underline; }
.post-flair-tag { background: var(--flair-bg); color: var(--flair-text); font-size: 11px; font-weight: 500; padding: 2px 10px; border-radius: var(--radius-full); }
.post-title-h1 { font-size: 22px; font-weight: 600; line-height: 1.3; margin: 8px 0 12px; color: var(--text-primary); }
.post-body { font-size: 15px; line-height: 1.8; color: var(--text-primary); }
.post-body p { margin-bottom: 16px; }
.post-body strong { color: var(--text-primary); font-weight: 600; }
.post-image { margin: 16px 0; border-radius: var(--radius-md); overflow: hidden; }
.post-image img { width: 100%; height: auto; max-height: 500px; object-fit: cover; }
.post-footer { display: flex; gap: 4px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--border-color); }
.post-footer .action-btn { background: none; border: none; color: var(--text-secondary); font-size: 12px; font-weight: 700; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 6px; }
.post-footer .action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.comments-box { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; }
.comments-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); }
.comments-count { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.sort-select { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 13px; }
.comment { display: flex; gap: 8px; padding: 12px 0; }
.comment + .comment { border-top: 1px solid var(--border-color); }
.comment-vote { display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 2px; }
.comment-vote .vote-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 12px; padding: 2px; }
.comment-vote .vote-btn.up:hover { color: var(--upvote); }
.comment-vote .vote-btn.down:hover { color: var(--downvote); }
.comment-main { flex: 1; min-width: 0; }
.comment-header { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-meta); margin-bottom: 6px; }
.comment-avatar { width: 22px; height: 22px; border-radius: 50%; }
.comment-author { font-weight: 700; color: var(--text-link); }
.comment-author:hover { text-decoration: underline; }
.comment-sep { color: var(--text-secondary); }
.comment-body { font-size: 14px; line-height: 1.6; color: var(--text-primary); }
.comment-actions { display: flex; gap: 2px; margin-top: 6px; }
.comment-actions .action-btn { background: none; border: none; color: var(--text-secondary); font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; }
.comment-actions .action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.sidebar { position: sticky; top: 64px; height: fit-content; }
.sidebar-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; margin-bottom: 16px; }
.sidebar-banner { height: 72px; background: linear-gradient(135deg, #ff4500, #ff6b35); }
.sidebar-body { padding: 12px 16px; }
.sidebar-sub-header { display: flex; align-items: center; gap: 8px; margin-top: -20px; margin-bottom: 8px; }
.sidebar-sub-icon { width: 48px; height: 48px; border-radius: 50%; border: 3px solid var(--bg-card); }
.sidebar-sub-name { font-size: 14px; font-weight: 700; }
.sidebar-sub-name a:hover { text-decoration: underline; color: var(--primary); }
.sidebar-stats { display: flex; gap: 24px; padding: 8px 0; border-top: 1px solid var(--border-color); margin: 8px 0; font-size: 12px; }
.stat-item .stat-num { display: block; font-size: 15px; font-weight: 700; color: var(--text-primary); }
.stat-item .stat-label { color: var(--text-secondary); }
.author-box { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-top: 8px; }
.author-box img { width: 40px; height: 40px; border-radius: 50%; }
.author-box-name { font-weight: 700; font-size: 13px; }
.author-box-name a:hover { color: var(--primary); text-decoration: underline; }
.author-box-meta { font-size: 11px; color: var(--text-secondary); }
.related-item { padding: 8px 0; border-bottom: 1px solid var(--border-color); }
.related-item:last-child { border: none; }
.related-link { font-size: 13px; color: var(--text-primary); line-height: 1.3; display: block; }
.related-link:hover { color: var(--primary); }
.related-stats { font-size: 11px; color: var(--text-secondary); margin-top: 2px; display: block; }
</style>
</head>
<body>
${sharedHeader('')}
<div class="breadcrumb">
  <a href="/">reddit</a> <span>›</span>
  <a href="/r/CrossBorderCommerce">r/CrossBorderCommerce</a> <span>›</span>
  <span style="color:var(--text-primary)">${post.title.substring(0, 50)}...</span>
</div>
<div class="page-layout">
  <div class="main-col">
    <div class="post-full">
      <div class="post-header">
        <img class="meta-avatar" src="/images/subreddit_icon.png" alt="">
        <a href="/r/CrossBorderCommerce" class="meta-sub">r/CrossBorderCommerce</a>
        <span>•</span>
        <span>Posted by <a class="author-link" href="/user/${post.author}/posts">u/${post.author}</a></span>
        <span>•</span>
        <span>${post.created}</span>
        <span class="post-flair-tag">${post.flair}</span>
      </div>
      <h1 class="post-title-h1">${post.title}</h1>
      ${imageHtml}
      <div class="post-body"><p>${contentHtml}</p></div>
      <div class="post-footer">
        <button class="action-btn">▲ ${post.score}</button>
        <button class="action-btn">💬 ${post.comments_count} Comments</button>
      </div>
    </div>
    <div class="comments-box">
      <div class="comments-top">
        <span class="comments-count">${post.comments_count} Comments</span>
        <select class="sort-select" id="comment-sort" onchange="sortComments(this.value)">
          <option value="best">Sort by: Best</option>
          <option value="top">Sort by: Top</option>
          <option value="new">Sort by: New</option>
          <option value="controversial">Sort by: Controversial</option>
          <option value="old">Sort by: Old</option>
        </select>
      </div>
      ${commentsHtml}
    </div>
  </div>
  <aside class="sidebar">
    <div class="sidebar-card">
      <div class="sidebar-banner"></div>
      <div class="sidebar-body">
        <div class="sidebar-sub-header">
          <img class="sidebar-sub-icon" src="/images/subreddit_icon.png" alt="">
          <span class="sidebar-sub-name"><a href="/r/CrossBorderCommerce">r/CrossBorderCommerce</a></span>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.4;">${SUBREDDIT.description}</p>
        <div class="sidebar-stats">
          <div class="stat-item"><span class="stat-num">${SUBREDDIT.members}</span><span class="stat-label">Members</span></div>
          <div class="stat-item"><span class="stat-num">${SUBREDDIT.online}</span><span class="stat-label">Online</span></div>
        </div>
      </div>
    </div>
    <div class="sidebar-card">
      <div class="sidebar-body">
        <h3 style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">About the Author</h3>
        <div class="author-box">
          <img src="${user.avatar}" alt="">
          <div>
            <div class="author-box-name"><a href="/user/${post.author}/posts">u/${post.author}</a></div>
            <div class="author-box-meta">${user.karma} karma • Cake day: ${user.cake_day}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-card">
      <div class="sidebar-body">
        <h3 style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">More from r/CrossBorderCommerce</h3>
        ${relatedPosts}
      </div>
    </div>
  </aside>
</div>
<script>
function sortComments(mode) {
  var box = document.querySelector('.comments-box');
  var comments = Array.from(box.querySelectorAll('.comment'));
  var timeOrder = {'1 day ago':1,'2 days ago':2,'3 days ago':3,'4 days ago':4,'1 week ago':7};
  comments.sort(function(a, b) {
    var sa = parseInt(a.dataset.score), sb = parseInt(b.dataset.score);
    var ta = timeOrder[a.dataset.time]||99, tb = timeOrder[b.dataset.time]||99;
    switch(mode) {
      case 'top': case 'best': return sb - sa;
      case 'new': return ta - tb;
      case 'controversial': return sa - sb;
      case 'old': return tb - ta;
      default: return sb - sa;
    }
  });
  var parent = comments[0] && comments[0].parentNode;
  if (parent) comments.forEach(function(c) { parent.appendChild(c); });
}
</script>
</body>
</html>`;
}

function renderUserProfilePage(browserReadyToken) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>u/TestUser_2024 - Reddit</title>
<style>
${sharedCSS()}
${headerCSS()}
.profile-banner { height: 200px; background: linear-gradient(135deg, #0079d3 0%, #4fbcff 100%); }
.profile-layout { max-width: 1000px; margin: -60px auto 0; padding: 0 24px; display: grid; grid-template-columns: minmax(0,1fr) 312px; gap: 24px; position: relative; }
.profile-main { }
.profile-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px; margin-bottom: 16px; }
.profile-header { display: flex; align-items: flex-end; gap: 16px; margin-bottom: 16px; }
.profile-avatar { width: 80px; height: 80px; border-radius: 50%; border: 4px solid var(--bg-card); }
.profile-name { font-size: 24px; font-weight: 700; }
.profile-username { font-size: 14px; color: var(--text-secondary); }
.profile-stats { display: flex; gap: 24px; margin: 16px 0; padding: 12px 0; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); }
.profile-stat { text-align: center; }
.profile-stat-num { display: block; font-size: 18px; font-weight: 700; }
.profile-stat-label { font-size: 12px; color: var(--text-secondary); }
.profile-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border-color); margin-bottom: 16px; }
.profile-tab { padding: 10px 16px; font-size: 14px; font-weight: 700; color: var(--text-secondary); border-bottom: 2px solid transparent; margin-bottom: -2px; cursor: pointer; }
.profile-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.empty-content { text-align: center; padding: 48px; color: var(--text-secondary); }
.empty-content h3 { margin-bottom: 8px; color: var(--text-primary); }
.profile-sidebar { position: sticky; top: 64px; height: fit-content; }
.trophy-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13px; color: var(--text-secondary); }
.trophy-icon { font-size: 20px; }
.cake-day { font-size: 13px; color: var(--text-secondary); margin-top: 8px; }
</style>
</head>
<body>
${sharedHeader('')}
<div class="profile-banner"></div>
<div class="profile-layout">
  <div class="profile-main">
    <div class="profile-card">
      <div class="profile-header">
        <img class="profile-avatar" src="/images/avatar_1.png" alt="">
        <div>
          <div class="profile-name">TestUser_2024</div>
          <div class="profile-username">u/TestUser_2024 • Joined Oct 12, 2024</div>
        </div>
      </div>
      <div class="profile-stats">
        <div class="profile-stat"><span class="profile-stat-num">1,247</span><span class="profile-stat-label">Post Karma</span></div>
        <div class="profile-stat"><span class="profile-stat-num">3,891</span><span class="profile-stat-label">Comment Karma</span></div>
        <div class="profile-stat"><span class="profile-stat-num">12</span><span class="profile-stat-label">Awards</span></div>
      </div>
    </div>
    <div class="profile-tabs">
      <span class="profile-tab active">Overview</span>
    </div>
    <div class="profile-card">
      <div class="empty-content">
        <h3>Welcome back, TestUser_2024!</h3>
        <p>You haven't posted anything yet. Browse communities and start engaging!</p>
        <p style="margin-top:16px;font-size:13px;">Popular communities you might like:
          r/AskReddit •
          r/todayilearned • r/worldnews
        </p>
      </div>
    </div>
  </div>
  <aside class="profile-sidebar">
    <div class="profile-card">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">Trophy Case</h3>
      <div class="trophy-item"><span class="trophy-icon">🏆</span> One-Year Club</div>
      <div class="trophy-item"><span class="trophy-icon">✉️</span> Verified Email</div>
      <div class="trophy-item"><span class="trophy-icon">🎂</span> <span>Cake Day: Oct 12, 2024</span></div>
    </div>
    <div class="profile-card">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">Subscribed Communities</h3>
      <div style="font-size:13px;color:var(--text-secondary);line-height:2;">
        <span style="display:block;">r/AskReddit</span>
        <span style="display:block;">r/todayilearned</span>
        <span style="display:block;">r/worldnews</span>
        <span style="display:block;">r/funny</span>
        <span style="display:block;">r/gaming</span>
      </div>
    </div>
  </aside>
</div>
<script>
document.cookie = '${BROWSER_READY_COOKIE_NAME}=${browserReadyToken}; Path=/; SameSite=Lax';
</script>
</body>
</html>`;
}

function renderSearchPage(query, results, activeTab) {
  activeTab = activeTab || 'posts';

  const tabs = [
    { id: 'posts', label: 'Posts', icon: '📝' },
    { id: 'comments', label: 'Comments', icon: '💬' },
    { id: 'communities', label: 'Communities', icon: '👥' },
    { id: 'people', label: 'People', icon: '👤' }
  ];

  const tabsHtml = tabs.map(t => {
    const cls = t.id === activeTab ? 'tab active' : 'tab';
    return `<a class="${cls}" href="/search?q=${encodeURIComponent(query)}&type=${t.id}">${t.icon} ${t.label}</a>`;
  }).join('');

  let contentHtml = '';

  if (activeTab === 'posts') {
    if (results.length === 0) {
      contentHtml = `<div class="empty-state"><div class="empty-icon">🔍</div><h3>Hm... we couldn't find any results for "${query}"</h3><p>Double-check your spelling or try different keywords</p></div>`;
    } else {
      contentHtml = results.map(post => {
        const user = USERS[post.author];
        const hasImage = post.image;
        return `
        <article class="result-card" onclick="window.location='/r/CrossBorderCommerce/comments/${post.id}'">
          <div class="vote-col">
            <button class="vote-btn up">▲</button>
            <span class="vote-score">${post.score}</span>
            <button class="vote-btn down">▼</button>
          </div>
          <div class="result-main">
            <div class="result-meta">
              <img class="meta-avatar" src="/images/subreddit_icon.png" alt="">
              <a href="/r/CrossBorderCommerce" class="meta-sub">r/CrossBorderCommerce</a>
              <span class="meta-dot">•</span>
              <span>Posted by <a href="/user/${post.author}/posts" class="meta-author">u/${post.author}</a></span>
              <span class="meta-dot">•</span>
              <span>${post.created}</span>
            </div>
            <h3 class="result-title"><a href="/r/CrossBorderCommerce/comments/${post.id}">${post.title}</a></h3>
            <span class="post-flair">${post.flair}</span>
            ${hasImage ? `<div class="result-thumb"><img src="${post.image}" alt=""></div>` : ''}
            <p class="result-preview">${post.content.substring(0, 200)}...</p>
            <div class="result-actions">
              <button class="action-btn">💬 ${post.comments_count} Comments</button>
            </div>
          </div>
        </article>`;
      }).join('');
    }
  } else if (activeTab === 'comments') {
    const allComments = [];
    Object.entries(COMMENTS).forEach(([postId, cmts]) => {
      const post = POSTS.find(p => p.id === postId);
      cmts.forEach(c => {
        if (!query || c.content.toLowerCase().includes(query.toLowerCase()) || c.author.toLowerCase().includes(query.toLowerCase())) {
          allComments.push({ ...c, postId, postTitle: post ? post.title : '' });
        }
      });
    });
    if (allComments.length === 0) {
      contentHtml = `<div class="empty-state"><div class="empty-icon">💬</div><h3>No comments found for "${query}"</h3></div>`;
    } else {
      contentHtml = allComments.map(c => {
        const cUser = USERS[c.author];
        return `
        <div class="comment-result" onclick="window.location='/r/CrossBorderCommerce/comments/${c.postId}'">
          <div class="comment-result-meta">
            <img class="meta-avatar" src="${cUser.avatar}" alt="">
            <a href="/user/${c.author}/posts" class="meta-author">${c.author}</a>
            <span class="meta-dot">•</span>
            <span>${c.score} points</span>
            <span class="meta-dot">•</span>
            <span>${c.created}</span>
          </div>
          <p class="comment-result-body">${c.content}</p>
          <div class="comment-result-source">
            <span class="meta-sub">r/CrossBorderCommerce</span> • ${c.postTitle.substring(0, 80)}...
          </div>
        </div>`;
      }).join('');
    }
  } else if (activeTab === 'communities') {
    contentHtml = `
    <div class="community-result">
      <img class="community-icon" src="/images/subreddit_icon.png" alt="">
      <div class="community-info">
        <a href="/r/CrossBorderCommerce" class="community-name">r/CrossBorderCommerce</a>
        <span class="community-members">${SUBREDDIT.members} members</span>
        <p class="community-desc">${SUBREDDIT.description}</p>
      </div>
      <button class="join-btn-sm">Joined</button>
    </div>`;
  } else if (activeTab === 'people') {
    const matchedUsers = Object.entries(USERS).filter(([name]) =>
      !query || name.toLowerCase().includes(query.toLowerCase())
    );
    if (matchedUsers.length === 0) {
      contentHtml = `<div class="empty-state"><div class="empty-icon">👤</div><h3>No users found for "${query}"</h3></div>`;
    } else {
      contentHtml = matchedUsers.map(([name, u]) => `
        <div class="people-result">
          <img class="people-avatar" src="${u.avatar}" alt="">
          <div class="people-info">
            <a href="/user/${name}/posts" class="people-name">u/${name}</a>
            <span class="people-karma">${u.karma} karma • Cake day: ${u.cake_day}</span>
          </div>
        </div>`).join('');
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>reddit: search results - ${query}</title>
<style>
${sharedCSS()}
${headerCSS()}
.search-tabs { background: var(--bg-card); border-bottom: 1px solid var(--border-color); }
.search-tabs-inner { max-width: 880px; margin: 0 auto; display: flex; padding: 0 24px; }
.tab { padding: 12px 16px; font-size: 14px; font-weight: 700; color: var(--text-secondary); border-bottom: 3px solid transparent; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.15s; }
.tab:hover { color: var(--text-primary); }
.tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.search-layout { max-width: 880px; margin: 16px auto; display: grid; grid-template-columns: minmax(0,1fr) 260px; gap: 24px; padding: 0 24px; }
.results-feed { display: flex; flex-direction: column; }
.results-info { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
.result-card { display: flex; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s; }
.result-card:hover { border-color: var(--text-secondary); }
.vote-col { display: flex; flex-direction: column; align-items: center; padding: 8px 4px; min-width: 40px; background: rgba(0,0,0,0.1); border-radius: var(--radius-md) 0 0 var(--radius-md); }
.vote-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; font-size: 14px; line-height: 1; }
.vote-btn.up:hover { color: var(--upvote); }
.vote-btn.down:hover { color: var(--downvote); }
.vote-score { font-size: 12px; font-weight: 700; color: var(--text-primary); margin: 2px 0; }
.result-main { flex: 1; padding: 10px 12px; min-width: 0; }
.result-meta { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-meta); flex-wrap: wrap; }
.meta-avatar { width: 20px; height: 20px; border-radius: 50%; }
.meta-sub { font-weight: 700; color: var(--text-primary); }
.meta-sub:hover { text-decoration: underline; }
.meta-author:hover { text-decoration: underline; }
.meta-dot { margin: 0 2px; }
.result-title { font-size: 16px; font-weight: 500; margin: 6px 0 4px; line-height: 1.3; }
.result-title a { color: var(--text-title); }
.result-title a:hover { color: var(--primary); }
.post-flair { background: var(--flair-bg); color: var(--flair-text); font-size: 11px; font-weight: 500; padding: 1px 8px; border-radius: var(--radius-full); }
.result-thumb { margin: 8px 0; border-radius: var(--radius-sm); overflow: hidden; max-height: 200px; }
.result-thumb img { width: 100%; height: auto; max-height: 200px; object-fit: cover; }
.result-preview { font-size: 13px; color: var(--text-secondary); line-height: 1.4; margin: 6px 0; max-height: 2.8em; overflow: hidden; }
.result-actions { display: flex; gap: 2px; margin-top: 4px; }
.action-btn { background: none; border: none; color: var(--text-secondary); font-size: 12px; font-weight: 700; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; }
.action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.comment-result { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s; }
.comment-result:hover { border-color: var(--text-secondary); }
.comment-result-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-meta); margin-bottom: 6px; }
.comment-result-body { font-size: 14px; line-height: 1.5; color: var(--text-primary); margin-bottom: 8px; }
.comment-result-source { font-size: 12px; color: var(--text-secondary); padding-top: 8px; border-top: 1px solid var(--border-color); }
.community-result { display: flex; align-items: center; gap: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; }
.community-icon { width: 48px; height: 48px; border-radius: 50%; }
.community-info { flex: 1; }
.community-name { font-size: 15px; font-weight: 700; color: var(--text-primary); display: block; }
.community-name:hover { text-decoration: underline; }
.community-members { font-size: 12px; color: var(--text-secondary); }
.community-desc { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
.join-btn-sm { padding: 6px 16px; border: none; border-radius: var(--radius-full); background: var(--primary); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
.people-result { display: flex; align-items: center; gap: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 8px; }
.people-avatar { width: 40px; height: 40px; border-radius: 50%; }
.people-name { font-size: 14px; font-weight: 700; color: var(--text-primary); display: block; }
.people-name:hover { text-decoration: underline; color: var(--primary); }
.people-karma { font-size: 12px; color: var(--text-secondary); }
.empty-state { text-align: center; padding: 48px 16px; color: var(--text-secondary); }
.empty-icon { font-size: 48px; margin-bottom: 16px; }
.empty-state h3 { color: var(--text-primary); font-size: 18px; margin-bottom: 8px; }
.empty-state p { font-size: 14px; }
.search-sidebar { position: sticky; top: 64px; height: fit-content; }
.search-sidebar-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-bottom: 12px; }
.search-sidebar-card h3 { font-size: 13px; font-weight: 700; margin-bottom: 10px; color: var(--text-primary); }
.tips-list { list-style: none; }
.tips-list li { font-size: 13px; color: var(--text-secondary); padding: 4px 0; line-height: 1.5; }
.tips-list code { background: var(--flair-bg); padding: 1px 6px; border-radius: 3px; font-size: 12px; color: var(--text-primary); }
</style>
</head>
<body>
${sharedHeader(query)}
<div class="search-tabs">
  <div class="search-tabs-inner">${tabsHtml}</div>
</div>
<div class="search-layout">
  <div class="results-feed">
    <div class="results-info">${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"</div>
    ${contentHtml}
  </div>
  <aside class="search-sidebar">
    <div class="search-sidebar-card">
      <h3>Search Tips</h3>
      <ul class="tips-list">
        <li>Use <code>author:username</code> to filter by user</li>
        <li>Use <code>flair:Guide</code> to filter by flair</li>
        <li>Put phrases in <code>"quotes"</code> for exact match</li>
        <li>Try broader terms if no results found</li>
      </ul>
    </div>
    <div class="search-sidebar-card">
      <h3>r/CrossBorderCommerce</h3>
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.4;">${SUBREDDIT.description}</p>
    </div>
  </aside>
</div>
</body>
</html>`;
}

// ============ Routes ============

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'reddit_mock' });
});

app.use(requireBrowserClient);

// Source page: this is the "already logged in" page that sets auth cookies
app.get('/session/source', (req, res) => {
  const browserReadyToken = crypto.randomBytes(32).toString('base64url');
  browserReadyTokens.add(browserReadyToken);
  // Set the real auth cookies
  res.cookie(SESSION_COOKIE_NAME, VALID_SESSION, { httpOnly: true, path: '/', maxAge: 86400000 });
  res.cookie(TOKEN_COOKIE_NAME, VALID_TOKEN, { httpOnly: false, path: '/', maxAge: 86400000 });

  // Set decoy cookies
  Object.entries(DECOY_COOKIES).forEach(([name, value]) => {
    res.cookie(name, value, { path: '/', maxAge: 86400000 });
  });

  // Serve a user profile page — NOT the target subreddit content
  res.send(renderUserProfilePage(browserReadyToken));
});

// Access log endpoint used by the host verifier.
app.get('/api/access-log', requireVerifierToken, (req, res) => {
  res.json(accessLog);
});

// === CLI mode: optional API-only surface (gated by MOCK_ALLOW_CLI=1) ===
// Mirrors the read-only HTML pages below as JSON endpoints. Bearer auth
// (Authorization: Bearer <MOCK_CLI_TOKEN>) replaces the browser cookie +
// browser_ready dance. Registered BEFORE the post-auth middleware below
// so CLI routes don't get blocked on missing session cookies. Each route
// logs an `event:'cli_access_valid'` entry the verifier looks for.
if (ALLOW_CLI) {
  app.post('/api/cli/session', requireCliClient, (req, res) => {
    logCliAccess(req);
    res.json({ authenticated: true });
  });

  app.get('/api/cli/subreddits/:name/posts', requireCliClient, (req, res) => {
    logCliAccess(req);
    // Mock only carries r/CrossBorderCommerce; any name returns the full POSTS array.
    const summaries = POSTS.map((p) => ({
      id: p.id,
      title: p.title,
      author: p.author,
      score: p.score,
      comments_count: p.comments_count,
      created: p.created,
      type: p.type,
      flair: p.flair || null,
    }));
    res.json({ subreddit: req.params.name, posts: summaries });
  });

  app.get('/api/cli/users/:username/posts', requireCliClient, (req, res) => {
    logCliAccess(req);
    const userPosts = POSTS.filter((p) => p.author === req.params.username);
    if (userPosts.length === 0) {
      return res.status(404).json({ error: 'user_not_found', username: req.params.username });
    }
    res.json({ username: req.params.username, posts: userPosts });
  });

  app.get('/api/cli/posts/:postId', requireCliClient, (req, res) => {
    logCliAccess(req);
    const post = POSTS.find((p) => p.id === req.params.postId);
    if (!post) return res.status(404).json({ error: 'post_not_found', postId: req.params.postId });
    const comments = COMMENTS[post.id] || [];
    res.json({ post, comments });
  });

  app.get('/api/cli/search', requireCliClient, (req, res) => {
    logCliAccess(req);
    const query = String(req.query.q || '').toLowerCase();
    if (!query) return res.json({ query: '', results: [] });
    const results = POSTS.filter((p) =>
      p.title.toLowerCase().includes(query) ||
      p.content.toLowerCase().includes(query) ||
      p.author.toLowerCase().includes(query)
    ).map((p) => ({ id: p.id, title: p.title, author: p.author, score: p.score }));
    res.json({ query: req.query.q, results });
  });
}

// All other routes require auth
app.use((req, res, next) => {
  if (req.path === '/session/source' || req.path.startsWith('/images/') || req.path === '/api/access-log') {
    return next();
  }
  if (!isAuthenticated(req)) {
    accessLog.push({
      path: req.path,
      timestamp: Date.now(),
      method: req.method,
      blocked: true,
      reason: 'auth_required',
      userAgent: String(req.get('user-agent') || '').slice(0, 160),
    });
    return res.status(403).send(renderBlockedPage());
  }
  if (!hasBrowserReadyCookie(req)) {
    accessLog.push({
      path: req.path,
      timestamp: Date.now(),
      method: req.method,
      blocked: true,
      reason: 'browser_session_required',
      userAgent: String(req.get('user-agent') || '').slice(0, 160),
    });
    return res.status(403).send(renderBrowserRequiredPage('browser session cookie missing'));
  }
  accessLog.push({
    path: req.path,
    timestamp: Date.now(),
    method: req.method,
    userAgent: String(req.get('user-agent') || '').slice(0, 160),
  });
  next();
});

// Subreddit feed
app.get('/', (req, res) => {
  res.send(renderSubredditPage(POSTS));
});

app.get('/r/CrossBorderCommerce', (req, res) => {
  res.send(renderSubredditPage(POSTS));
});

// Individual post
app.get('/r/CrossBorderCommerce/comments/:postId', (req, res) => {
  const post = POSTS.find(p => p.id === req.params.postId);
  if (!post) return res.status(404).send('Post not found');
  const comments = COMMENTS[post.id] || [];
  res.send(renderPostPage(post, comments));
});

// Search
app.get('/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const type = req.query.type || 'posts';
  if (!query) return res.send(renderSearchPage('', [], type));

  const results = POSTS.filter(p =>
    p.title.toLowerCase().includes(query) ||
    p.content.toLowerCase().includes(query) ||
    p.author.toLowerCase().includes(query)
  );
  res.send(renderSearchPage(req.query.q, results, type));
});

// User posts
app.get('/user/:username/posts', (req, res) => {
  const username = req.params.username;
  const userPosts = POSTS.filter(p => p.author === username);
  if (userPosts.length === 0) return res.status(404).send('User not found');
  res.send(renderSearchPage(`posts by u/${username}`, userPosts));
});

// ============ Start Server ============
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Reddit Mock Service running on http://localhost:${PORT}`);
  console.log(`  Source page (sets cookies): http://localhost:${PORT}/session/source`);
  console.log(`  Protected feed: http://localhost:${PORT}/r/CrossBorderCommerce`);
  console.log(`  Search: http://localhost:${PORT}/search?q=supplier`);
  if (ALLOW_CLI) {
    console.log('  [dual-mode] /api/cli/* mounted; Bearer auth via MOCK_CLI_TOKEN');
  }
});
