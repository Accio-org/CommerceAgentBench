const BASE_TIME = Date.parse('2026-06-01T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const MARKETS = ['US', 'UK', 'DE', 'JP', 'BR', 'MX', 'AU', 'SG'];
const CHANNELS = ['Shopify', 'Amazon', 'Alibaba', 'TikTok Shop', 'Walmart Marketplace'];
const CATEGORIES = ['Home & Kitchen', 'Pet Supplies', 'Consumer Electronics', 'Outdoor', 'Beauty', 'Office', 'Baby', 'Automotive'];
const OWNERS = ['Mei Chen', 'Ravi Patel', 'Ana Costa', 'Jon Miller', 'Yuki Tanaka', 'Lina Gomez', 'Owen Brooks', 'Iris Wang'];
const SUPPLIERS = [
  'Shenzhen Lumen Co.',
  'Ningbo Harbor Plastics',
  'Qingdao Greenfield Tools',
  'Suzhou BrightHome Manufacturing',
  'Dongguan Nova Pet Products',
  'Hangzhou Wellpack Trading',
  'Foshan Northstar Lighting',
  'Yiwu Meridian Supply',
  'Xiamen Bluewave Outdoor',
  'Guangzhou Orchid Beauty',
  'Hefei Vector Office',
  'Tianjin Alloy Components',
  'Wenzhou Coastline Hardware',
  'Jinhua Cedar Baby Goods',
  'Changzhou Prime Auto Parts',
  'Kunshan Atlas Packaging',
  'Zhongshan PureBath',
  'Shaoxing Willow Textile',
];

function date(offsetDays) {
  return new Date(BASE_TIME + offsetDays * DAY_MS).toISOString();
}

function day(offsetDays) {
  return date(offsetDays).slice(0, 10);
}

function pad(num, width = 3) {
  return String(num).padStart(width, '0');
}

function pick(values, idx, shift = 0) {
  return values[(idx + shift) % values.length];
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function page(id, title, parentId, properties, content, offsetDays = -30) {
  return {
    id,
    parentType: parentId?.startsWith('db_') ? 'database' : 'page',
    parentId,
    title,
    content,
    properties,
    archived: false,
    createdAt: date(offsetDays - 5),
    updatedAt: date(offsetDays),
    createdBy: 'usr_mock_001',
  };
}

function knowledgePage(id, title, properties, sections, sources, offsetDays = -20) {
  const sourceLines = sources.map((source, idx) => `${idx + 1}. ${source.label}: ${source.url}`).join('\n');
  const body = sections.map(section => `## ${section.heading}\n\n${section.body}`).join('\n\n');
  return page(
    id,
    title,
    'db_commerce_knowledge',
    {
      Domain: properties.domain,
      UseCase: properties.useCase,
      Market: properties.market || 'Global',
      SourceType: 'web_research_summary',
      ReviewStatus: properties.reviewStatus || 'Approved',
      Owner: properties.owner || 'Commerce Ops Enablement',
      LastReviewed: day(offsetDays),
    },
    `# ${title}\n\n${body}\n\n## Source links\n\n${sourceLines}\n\n## Bench note\n\nThis page is a paraphrased operations note derived from the linked public sources. It is not a verbatim copy of the source material.`,
    offsetDays
  );
}

function datasource(id, databaseId, title, properties, pages) {
  return { id, databaseId, title, properties, pages, createdAt: date(-90) };
}

function event(id, offsetDays, action, entityType, entityId, details = {}) {
  return { id, timestamp: date(offsetDays), action, entityType, entityId, details };
}

function file(id, filename, contentType, contentLength, offsetDays = -20) {
  return {
    id,
    filename,
    status: 'uploaded',
    contentType,
    contentLength,
    externalUrl: null,
    createdAt: date(offsetDays),
    lastEdited: date(offsetDays),
    expiryTime: date(180),
  };
}

function addCommerceWorkers(entities, events) {
  const workers = [
    ['wkr_commerce_catalog_sync', 'commerce-product-catalog-sync', 'syncProductCatalog', 'Commerce product catalog sync'],
    ['wkr_commerce_supplier_monitor', 'supplier-certificate-monitor', 'auditSupplierCertificates', 'Supplier certificate monitor'],
    ['wkr_commerce_order_import', 'marketplace-order-importer', 'importMarketplaceOrders', 'Marketplace order importer'],
    ['wkr_commerce_inventory_alerts', 'inventory-reorder-alerts', 'checkInventoryCoverage', 'Inventory reorder alerts'],
    ['wkr_commerce_po_tracker', 'po-shipment-tracker', 'syncPurchaseOrderStatus', 'Purchase order shipment tracker'],
    ['wkr_commerce_returns', 'returns-rma-router', 'routeReturnRequests', 'Returns RMA router'],
    ['wkr_commerce_listing_localization', 'listing-localization-publisher', 'publishLocalizedListings', 'Listing localization publisher'],
    ['wkr_commerce_campaign_export', 'campaign-calendar-export', 'exportCampaignCalendar', 'Campaign calendar export'],
  ];

  for (const [idx, [workerId, name, syncKey, title]] of workers.entries()) {
    entities.workers[workerId] = {
      id: workerId,
      name,
      status: idx === 1 ? 'warning' : 'active',
      createdAt: date(-120 + idx),
      updatedAt: date(-idx - 1),
      lastDeployedAt: date(-idx - 2),
      deployCount: 3 + idx,
      sourceHash: `sha256:commerce${pad(idx, 2)}${slug(name).slice(0, 10)}`,
      workspaceId: 'ws_mock_001',
    };
    entities.capabilities[`cap_${workerId}_sync`] = {
      id: `cap_${workerId}_sync`,
      workerId,
      key: syncKey,
      type: 'sync',
      title,
      description: `${title} for the ecommerce operations workspace.`,
      schema: { input: { type: 'object', properties: {} } },
      createdAt: date(-119 + idx),
      updatedAt: date(-idx - 1),
    };
    entities.envVars[`env_${workerId}_workspace`] = {
      id: `env_${workerId}_workspace`,
      workerId,
      key: 'COMMERCE_WORKSPACE_ID',
      value: 'ws_mock_001',
      isSet: true,
      updatedAt: date(-idx - 3),
    };
    entities.envVars[`env_${workerId}_mode`] = {
      id: `env_${workerId}_mode`,
      workerId,
      key: 'RUN_MODE',
      value: idx === 1 ? 'audit' : 'production',
      isSet: true,
      updatedAt: date(-idx - 3),
    };
    entities.syncs[`sync_${workerId}`] = {
      id: `sync_${workerId}`,
      workerId,
      capabilityKey: syncKey,
      status: idx === 1 ? 'paused' : 'running',
      cursor: { page: idx + 2, watermark: `commerce_${pad(idx, 2)}_${pad(40 + idx)}` },
      lastRunAt: date(-idx - 1),
      nextRunAt: date(idx + 1),
      runCount: 18 + idx * 4,
      errorCount: idx === 1 ? 2 : 0,
      schedule: idx % 2 === 0 ? '*/30 * * * *' : '0 */4 * * *',
    };
    entities.runs[`run_${workerId}_latest`] = {
      id: `run_${workerId}_latest`,
      workerId,
      capabilityKey: syncKey,
      capabilityType: 'sync',
      status: idx === 1 ? 'failed' : 'completed',
      startedAt: date(-idx - 1),
      completedAt: date(-idx - 1),
      durationMs: 1800 + idx * 230,
      input: {},
      output: idx === 1 ? null : { processed: 80 + idx * 11, skipped: idx },
      logs: [
        { timestamp: date(-idx - 1), level: 'info', message: `Starting ${syncKey}` },
        {
          timestamp: date(-idx - 1),
          level: idx === 1 ? 'error' : 'info',
          message: idx === 1 ? 'Certificate expiry check failed for 3 suppliers' : `Completed ${syncKey}`,
        },
      ],
    };
    events.push(event(`evt_commerce_worker_${idx}`, -100 + idx, 'worker.create', 'worker', workerId, { name }));
    events.push(event(`evt_commerce_sync_${idx}`, -idx - 1, idx === 1 ? 'run.failed' : 'run.completed', 'run', `run_${workerId}_latest`, { capability: syncKey }));
  }
}

export function generateCommerceSeedOverlay() {
  const entities = {
    workers: {},
    capabilities: {},
    envVars: {},
    syncs: {},
    oauthTokens: {},
    runs: {},
    webhooks: {},
    pages: {},
    datasources: {},
    files: {},
  };
  const events = [];
  const fileBlobs = {};

  entities.pages.page_commerce_home = page(
    'page_commerce_home',
    'Commerce Operations Home',
    'page_root',
    {},
    '# Commerce Operations Home\n\nCentral workspace for product launches, supplier reviews, purchase orders, inventory alerts, campaigns, listing localization, and customer issues.\n\n## Databases\n\n- Commerce Product Catalog\n- Marketplace Listing Ops\n- Supplier Due Diligence\n- Purchase Order Tracker\n- Inventory Replenishment\n- Campaign Calendar\n- Customer Issue Queue',
    -120
  );
  entities.pages.page_commerce_policy = page(
    'page_commerce_policy',
    'Launch Readiness Policy',
    'page_commerce_home',
    {},
    '# Launch Readiness Policy\n\nProducts are launch-ready only when listing QA is approved, supplier certification is current, landed margin is above threshold, and inventory coverage exceeds the channel target.',
    -110
  );
  entities.pages.page_commerce_supplier_sop = page(
    'page_commerce_supplier_sop',
    'Supplier Certificate SOP',
    'page_commerce_home',
    {},
    '# Supplier Certificate SOP\n\nHold suppliers for legal review when certificate site, expiry, issuer, or certificate number conflicts with launch records.',
    -100
  );
  entities.pages.page_commerce_weekly = page(
    'page_commerce_weekly',
    'Weekly Commerce Standup Notes',
    'page_commerce_home',
    {},
    '# Weekly Commerce Standup Notes\n\nFocus this week: JP launch localization, TikTok Shop bundle QA, supplier certificate renewals, and FBA reorder windows.',
    -7
  );

  const knowledgeSources = {
    shopifyProducts: {
      label: 'Shopify Help Center - Products',
      url: 'https://help.shopify.com/en/manual/products',
    },
    shopifyProductDetails: {
      label: 'Shopify Help Center - Product details page',
      url: 'https://help.shopify.com/en/manual/products/details/product-details-page',
    },
    shopifyTransfers: {
      label: 'Shopify Help Center - Inventory transfers and shipments',
      url: 'https://help.shopify.com/en/manual/products/inventory/inventory-transfers',
    },
    shopifyTracking: {
      label: 'Shopify Help Center - Order tracking',
      url: 'https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/order-tracking',
    },
    shopifyReturns: {
      label: 'Shopify Help Center - Returns and exchanges',
      url: 'https://help.shopify.com/en/manual/fulfillment/managing-orders/returns',
    },
    googleSpec: {
      label: 'Google Merchant Center - Product data specification',
      url: 'https://support.google.com/merchants/answer/7052112/product-data-specification',
    },
    googleShippingReturns: {
      label: 'Google Search Central - Shipping and returns information',
      url: 'https://developers.google.com/search/blog/2023/04/shipping-and-returns-information',
    },
    amazonStyle: {
      label: 'Amazon public product listing style guide',
      url: 'https://m.media-amazon.com/images/G/39/help/Watches_Styleguide_EN_AE._CB1198675309_.pdf',
    },
  };

  const knowledgeIds = [];
  const knowledgeDocs = [
    knowledgePage('page_com_knowledge_001', 'Product Catalog Field Readiness SOP', {
      domain: 'Product Catalog', useCase: 'Launch readiness', market: 'Global', owner: 'Catalog Ops',
    }, [
      {
        heading: 'Minimum viable product record',
        body: 'A launchable catalog record must have a clean title, price, description, media, inventory policy, channel visibility, and variant data. Shopify can technically create a product with very few fields, but the operations gate treats that as a draft-only state. A product that lacks image, variant, tag, or metafield detail should stay out of paid channels until the catalog team can explain the missing fields.',
      },
      {
        heading: 'Operational checks',
        body: 'Before moving a SKU from Draft to Active, reviewers should compare title, description, variant labels, price, compare-at price, inventory quantity, tags, and metafields against the launch brief. If only title and price exist, treat the record as incomplete even if the platform accepts it.',
      },
      {
        heading: 'Failure pattern',
        body: 'The common failure is publishing a product whose back-office record is technically valid but commercially thin. In Notion triage, mark these as Needs Catalog Detail and link the missing attribute list to the SKU owner.',
      },
    ], [knowledgeSources.shopifyProducts, knowledgeSources.shopifyProductDetails], -28),
    knowledgePage('page_com_knowledge_002', 'Product Status and Channel Visibility SOP', {
      domain: 'Product Catalog', useCase: 'Status triage', market: 'Global', owner: 'Catalog Ops',
    }, [
      {
        heading: 'Status meaning',
        body: 'Use Draft for work-in-progress records, Active for products intended to be purchasable through configured channels, and Archived for products that should be removed from routine merchandising workflows. Unlisted or channel-limited products need extra review because a product can be discoverable through direct references even when it is not shown in standard browsing surfaces.',
      },
      {
        heading: 'Review rule',
        body: 'A SKU should not be marked launch-ready by status alone. Confirm whether the target market/channel can actually see it, whether stock exists at a fulfillable location, and whether feed attributes are complete.',
      },
      {
        heading: 'Notion handling',
        body: 'When the issue is status-only, update the product task with the exact current status and the intended publish state. When the issue is channel visibility, assign it to marketplace ops rather than catalog copy.',
      },
    ], [knowledgeSources.shopifyProductDetails], -27),
    knowledgePage('page_com_knowledge_003', 'Google Merchant Feed Core Attributes Checklist', {
      domain: 'Feed Quality', useCase: 'Merchant Center QA', market: 'Global', owner: 'Marketplace Ops',
    }, [
      {
        heading: 'Required surface data',
        body: 'The feed QA pass should confirm title, description, landing page link, image link, availability, and price. Product pages should use stable HTTP or HTTPS landing URLs on a verified domain, and images should be product-focused rather than placeholders.',
      },
      {
        heading: 'Availability and price',
        body: 'Availability must use supported values such as in stock, out of stock, preorder, or backorder. Price must be numeric and carry an ISO currency code. If store inventory says a SKU is available but the feed says out of stock, inventory ops owns the stock truth while marketplace ops owns feed correction.',
      },
      {
        heading: 'Notion handling',
        body: 'For feed defects, create one issue per SKU and market. Include the broken attribute, the current value, the expected value, and the channel where the defect is visible.',
      },
    ], [knowledgeSources.googleSpec], -26),
    knowledgePage('page_com_knowledge_004', 'Identifier QA for GTIN and MPN', {
      domain: 'Feed Quality', useCase: 'Identifier validation', market: 'Global', owner: 'Marketplace Ops',
    }, [
      {
        heading: 'Identifier decision tree',
        body: 'Prefer a valid GTIN when the manufacturer assigned one. If a product does not have a manufacturer-assigned GTIN, use MPN and brand fields consistently. Do not invent identifiers to satisfy a required-looking field.',
      },
      {
        heading: 'Common defects',
        body: 'Reject GTINs that include spaces or dashes, fail checksum validation, use restricted ranges, or look like coupons. When an identifier is missing, the triage note should say whether this is a true no-GTIN item or a data collection gap.',
      },
      {
        heading: 'Notion handling',
        body: 'Escalate to supplier ops when source paperwork is missing. Escalate to marketplace ops when paperwork has the identifier but the feed value is malformed.',
      },
    ], [knowledgeSources.googleSpec], -25),
    knowledgePage('page_com_knowledge_005', 'Product Detail, Highlight, and Dimension QA', {
      domain: 'Feed Quality', useCase: 'Rich attribute review', market: 'Global', owner: 'Marketplace Ops',
    }, [
      {
        heading: 'Detail attributes',
        body: 'Use product detail fields for technical specifications that help comparison, such as material, dimensions, compatibility, or model detail. Use highlights for short customer-facing benefits. Avoid repeating the same statement across description, details, and highlights.',
      },
      {
        heading: 'Dimension consistency',
        body: 'When length, width, height, or weight is present, keep units consistent. Mixed units create display and comparison problems. Dimensions should describe the product or package according to the channel rule being checked.',
      },
      {
        heading: 'Notion handling',
        body: 'If dimension data conflicts with supplier pack sheets, leave the SKU in Needs Supplier Data and attach the conflicting values rather than choosing a value silently.',
      },
    ], [knowledgeSources.googleSpec], -24),
    knowledgePage('page_com_knowledge_006', 'Marketplace Product Description Style Guide', {
      domain: 'Listing Content', useCase: 'Copy QA', market: 'Global', owner: 'Listing Ops',
    }, [
      {
        heading: 'Description standard',
        body: 'Product descriptions should explain what the item is, what differentiates it, and the relevant material, model, size, or care details. Use complete sentences and base claims on manufacturer-approved information.',
      },
      {
        heading: 'Prohibited content',
        body: 'Avoid seller-specific offers, pricing, delivery promises, vendor contact details, and unsupported superlatives in product descriptions. These belong in offer or fulfillment fields, not in reusable product content.',
      },
      {
        heading: 'Notion handling',
        body: 'Flag descriptions that read like ad copy or logistics copy. Assign price/delivery language to marketplace ops and unsupported product claims to compliance review.',
      },
    ], [knowledgeSources.amazonStyle, knowledgeSources.googleSpec], -23),
    knowledgePage('page_com_knowledge_007', 'Image and Landing Page QA Runbook', {
      domain: 'Feed Quality', useCase: 'Image and URL review', market: 'Global', owner: 'Creative Ops',
    }, [
      {
        heading: 'Landing page checks',
        body: 'Landing pages should resolve directly to the product page on the verified merchant domain. Interstitial pages should be avoided except where legally required. The page should match the feed price, availability, and variant represented by the SKU.',
      },
      {
        heading: 'Image checks',
        body: 'Use the main product image as the primary image link. Placeholder, lifestyle-only, or unrelated images should block launch. For future-proofing, image assets should be large enough for marketplace requirements and should remain accessible from the feed.',
      },
      {
        heading: 'Notion handling',
        body: 'Image defects should include the asset filename, SKU, market, and a short reason such as placeholder, wrong variant, text overlay, or inaccessible URL.',
      },
    ], [knowledgeSources.googleSpec], -22),
    knowledgePage('page_com_knowledge_008', 'Inventory Transfer and Partial Receipt SOP', {
      domain: 'Inventory', useCase: 'Transfer reconciliation', market: 'Global', owner: 'Inventory Ops',
    }, [
      {
        heading: 'Transfer lifecycle',
        body: 'Inventory transfers are used to move stock between store locations or between external suppliers and store locations. A transfer can move through in-transit and receipt states, and operations may receive stock in full or in partial batches.',
      },
      {
        heading: 'Exception handling',
        body: 'When received quantity differs from shipped quantity, keep the purchase-order task open until the discrepancy is reconciled. Split shipments should carry tracking information per shipment rather than one blended note.',
      },
      {
        heading: 'Notion handling',
        body: 'For replenishment tasks, record source location, destination location, transfer status, tracking reference, expected quantity, received quantity, and whether the shortage affects launch coverage.',
      },
    ], [knowledgeSources.shopifyTransfers], -21),
    knowledgePage('page_com_knowledge_009', 'Order Tracking Customer Support SOP', {
      domain: 'Fulfillment', useCase: 'Tracking issue triage', market: 'Global', owner: 'CX Ops',
    }, [
      {
        heading: 'Tracking sources',
        body: 'After tracking is added to a fulfilled order, customers can normally see delivery progress through the order status page, shipping notification emails, and customer-facing order tracking surfaces. Tracking may be added automatically through label purchase or manually for external carriers.',
      },
      {
        heading: 'Support triage',
        body: 'When a customer cannot see tracking, first confirm whether the order was fulfilled, whether a tracking number exists, whether the carrier was recognized, and whether a direct tracking URL is needed.',
      },
      {
        heading: 'Notion handling',
        body: 'Escalate missing tracking to fulfillment ops if no tracking number exists. Escalate carrier mismatch to shipping ops if the tracking number exists but points to the wrong carrier.',
      },
    ], [knowledgeSources.shopifyTracking], -20),
    knowledgePage('page_com_knowledge_010', 'Returns and Exchanges Triage SOP', {
      domain: 'Customer Experience', useCase: 'RMA routing', market: 'Global', owner: 'CX Ops',
    }, [
      {
        heading: 'Return actions',
        body: 'A return workflow can involve refunding payment, receiving the original item, or exchanging it for another variant. The decision should be based on policy eligibility, inspection outcome, and whether the requested replacement is available.',
      },
      {
        heading: 'Policy rules',
        body: 'Return rules define which items are eligible and how return fees or windows apply. If a customer request is outside the configured rule, the task should be routed for exception review rather than automatically approved.',
      },
      {
        heading: 'Notion handling',
        body: 'RMA tasks should record original order, SKU, requested action, eligibility reason, inspection status, refund amount, and whether inventory should be restocked.',
      },
    ], [knowledgeSources.shopifyReturns], -19),
    knowledgePage('page_com_knowledge_011', 'Shipping and Returns Visibility SOP', {
      domain: 'Search and Merchant Trust', useCase: 'Policy consistency', market: 'Global', owner: 'Marketplace Ops',
    }, [
      {
        heading: 'Why it matters',
        body: 'Shipping speed, shipping cost, and return policy can appear in product discovery surfaces and influence shopper trust. Product feed, structured data, and Merchant Center settings should tell the same story.',
      },
      {
        heading: 'Consistency checks',
        body: 'Compare product page copy, Merchant Center shipping settings, return policy URLs, and any structured data. If search surfaces display outdated return terms, record which source is stale before editing.',
      },
      {
        heading: 'Notion handling',
        body: 'Policy visibility tasks should include the observed shopper-facing claim, the canonical policy, the likely source system, and the owner for correction.',
      },
    ], [knowledgeSources.googleShippingReturns, knowledgeSources.googleSpec], -18),
    knowledgePage('page_com_knowledge_012', 'EU Certification Attribute QA SOP', {
      domain: 'Compliance', useCase: 'Certification metadata', market: 'EU', owner: 'Compliance Ops',
    }, [
      {
        heading: 'Certification fields',
        body: 'For regulated product groups, certification metadata can require a certification authority, certification name, and code. For EU energy labeling contexts, the value must point to the appropriate authority and certificate code rather than a free-form marketing label.',
      },
      {
        heading: 'Review rule',
        body: 'If the product record has an energy or safety claim but lacks certificate code detail, keep it out of launch-ready status. Do not move the SKU forward based only on a PDF filename; verify the code and authority fields.',
      },
      {
        heading: 'Notion handling',
        body: 'Compliance tasks should include the certificate authority, certificate name, certificate code, source document, and the affected market.',
      },
    ], [knowledgeSources.googleSpec], -17),
    knowledgePage('page_com_knowledge_013', 'Variant Option Consistency SOP', {
      domain: 'Product Catalog', useCase: 'Variant QA', market: 'Global', owner: 'Catalog Ops',
    }, [
      {
        heading: 'Variant dimensions',
        body: 'Variant records should use clear option names and values, such as color, size, capacity, or screen size. The variant dimensions used in product data should match the product page and the buying options exposed in the store.',
      },
      {
        heading: 'Risk pattern',
        body: 'A common error is mixing product-specific detail with variant identity, such as placing bundle claims or promotional text into a variant option. This makes feed grouping and marketplace matching less reliable.',
      },
      {
        heading: 'Notion handling',
        body: 'When variant records conflict, leave the parent SKU open and attach the mismatched option names, affected child SKUs, and source system.',
      },
    ], [knowledgeSources.googleSpec, knowledgeSources.shopifyProducts], -16),
    knowledgePage('page_com_knowledge_014', 'Customer Issue to Catalog Defect Routing Guide', {
      domain: 'Customer Experience', useCase: 'Issue classification', market: 'Global', owner: 'CX Ops',
    }, [
      {
        heading: 'Routing rule',
        body: 'Customer issues about wrong variant, missing manual, or listing mismatch should be checked against catalog and listing data before being treated as a warehouse error. The same support symptom can originate from product content, feed mapping, fulfillment, or supplier packaging.',
      },
      {
        heading: 'Evidence required',
        body: 'A routing note should include the customer issue type, SKU, channel, order or ticket count, product page claim, and the matching catalog/listing record. If tracking is missing, use the fulfillment SOP instead of catalog routing.',
      },
      {
        heading: 'Notion handling',
        body: 'Escalate to listing ops when customer complaints cite inaccurate product copy. Escalate to inventory or fulfillment when the product page is correct but the shipped item or tracking event is wrong.',
      },
    ], [knowledgeSources.shopifyTracking, knowledgeSources.amazonStyle, knowledgeSources.shopifyProducts], -15),
    knowledgePage('page_com_knowledge_015', 'Campaign Launch Data Quality Checklist', {
      domain: 'Campaigns', useCase: 'Campaign readiness', market: 'Global', owner: 'Growth Ops',
    }, [
      {
        heading: 'Readiness inputs',
        body: 'Campaign readiness depends on product status, feed approval, image quality, price/availability consistency, inventory coverage, and return/shipping policy accuracy. A campaign should not start only because creative copy is complete.',
      },
      {
        heading: 'Launch blocker examples',
        body: 'Block launch when the product is draft, feed availability conflicts with store inventory, the main image is missing, or return information differs between the product page and Merchant Center.',
      },
      {
        heading: 'Notion handling',
        body: 'Campaign blockers should reference the underlying SKU issue and source system, not just the campaign page. This lets ops resolve the root defect once and unblock multiple markets.',
      },
    ], [knowledgeSources.shopifyProducts, knowledgeSources.googleSpec, knowledgeSources.googleShippingReturns], -14),
    knowledgePage('page_com_knowledge_016', 'Marketplace Feed Incident Postmortem Template', {
      domain: 'Feed Quality', useCase: 'Incident review', market: 'Global', owner: 'Marketplace Ops',
    }, [
      {
        heading: 'Incident structure',
        body: 'Document the affected SKUs, markets, attributes, shopper-facing symptom, source-of-truth value, detection time, correction time, and prevention rule. Use attribute names that match the feed or platform language.',
      },
      {
        heading: 'Root-cause categories',
        body: 'Common categories include missing required attribute, stale price or availability, invalid identifier, broken landing page, image issue, policy mismatch, and unsupported certification data.',
      },
      {
        heading: 'Notion handling',
        body: 'A postmortem should link all impacted product, listing, inventory, and campaign records. It should create follow-up tasks only for prevention gaps, not for already-remediated rows.',
      },
    ], [knowledgeSources.googleSpec, knowledgeSources.shopifyProductDetails], -13),
  ];
  for (const doc of knowledgeDocs) {
    knowledgeIds.push(doc.id);
    entities.pages[doc.id] = doc;
  }

  const productIds = [];
  for (let i = 1; i <= 240; i++) {
    const category = pick(CATEGORIES, i);
    const market = pick(MARKETS, i, 2);
    const channel = pick(CHANNELS, i, 1);
    const supplier = pick(SUPPLIERS, i, 3);
    const status = i % 29 === 0 ? 'Blocked' : i % 17 === 0 ? 'Needs Supplier Data' : i % 5 === 0 ? 'Live' : i % 3 === 0 ? 'Ready for QA' : 'Draft';
    const riskFlag = status === 'Blocked' || i % 23 === 0 ? 'Yes' : 'No';
    const sku = `CCB-${category.slice(0, 3).toUpperCase()}-${market}-${pad(i)}`;
    const id = `page_com_product_${pad(i)}`;
    productIds.push(id);
    entities.pages[id] = page(
      id,
      `${category} ${market} SKU ${pad(i)}`,
      'db_commerce_products',
      {
        SKU: sku,
        Status: status,
        Channel: channel,
        Market: market,
        Category: category,
        Supplier: supplier,
        Owner: pick(OWNERS, i),
        LaunchDate: day(-12 + (i % 80)),
        GMV30d: 2200 + i * 137,
        MarginPct: 18 + (i % 21),
        Priority: (i % 4) + 1,
        RiskFlag: riskFlag,
      },
      `# ${category} ${market} SKU ${pad(i)}\n\nSKU: ${sku}\nChannel: ${channel}\nMarket: ${market}\nSupplier: ${supplier}\nStatus: ${status}\nOwner: ${pick(OWNERS, i)}\n\nLaunch notes: ${riskFlag === 'Yes' ? 'Review supplier or inventory risk before publishing.' : 'Standard launch checks apply.'}`,
      -90 + (i % 70)
    );
  }

  const listingIds = [];
  const locales = ['en-US', 'en-GB', 'de-DE', 'ja-JP', 'pt-BR', 'es-MX'];
  const defects = ['title length', 'missing bullet', 'image alt text', 'claims substantiation', 'translation QA', 'category mapping'];
  for (let i = 1; i <= 160; i++) {
    const sku = entities.pages[pick(productIds, i)].properties.SKU;
    const locale = pick(locales, i);
    const status = i % 13 === 0 ? 'Blocked' : i % 7 === 0 ? 'In Review' : i % 4 === 0 ? 'Ready' : 'Open';
    const id = `page_com_listing_${pad(i)}`;
    listingIds.push(id);
    entities.pages[id] = page(
      id,
      `Listing QA ${locale} ${sku}`,
      'db_commerce_listing_ops',
      {
        SourceSKU: sku,
        Locale: locale,
        Channel: pick(CHANNELS, i),
        Status: status,
        Defect: pick(defects, i),
        Priority: (i % 5) + 1,
        Owner: pick(OWNERS, i, 2),
        DueDate: day(-5 + (i % 45)),
      },
      `# Listing QA ${locale} ${sku}\n\nDefect: ${pick(defects, i)}\nStatus: ${status}\nOwner: ${pick(OWNERS, i, 2)}\n\nQA note: verify localized marketplace copy against the approved product record before publishing.`,
      -80 + (i % 60)
    );
  }

  const supplierIds = [];
  for (let i = 1; i <= 90; i++) {
    const supplier = pick(SUPPLIERS, i);
    const status = i % 19 === 0 ? 'Hold' : i % 11 === 0 ? 'Needs Renewal' : i % 5 === 0 ? 'Watchlist' : 'Approved';
    const id = `page_com_supplier_${pad(i)}`;
    supplierIds.push(id);
    entities.pages[id] = page(
      id,
      `${supplier} supplier review ${pad(i)}`,
      'db_commerce_suppliers',
      {
        Supplier: supplier,
        Country: 'CN',
        Category: pick(CATEGORIES, i),
        CertificationStatus: status,
        CertificateExpiry: day(20 + (i % 220)),
        RiskTier: i % 19 === 0 ? 'High' : i % 5 === 0 ? 'Medium' : 'Low',
        Owner: pick(OWNERS, i, 4),
        LastReview: day(-30 + (i % 20)),
        RelatedSKUCount: 4 + (i % 18),
        LaunchBlocker: status === 'Hold' ? 'Yes' : 'No',
      },
      `# ${supplier} supplier review ${pad(i)}\n\nCertification status: ${status}\nCategory: ${pick(CATEGORIES, i)}\nRisk tier: ${i % 19 === 0 ? 'High' : i % 5 === 0 ? 'Medium' : 'Low'}\n\nReview note: ${status === 'Hold' ? 'Legal review required before launch.' : 'No launch blocker recorded.'}`,
      -70 + (i % 45)
    );
  }

  const poIds = [];
  const ports = ['Shenzhen', 'Ningbo', 'Qingdao', 'Xiamen', 'Yantian', 'Shanghai'];
  const destinations = ['LAX', 'LGB', 'SEA', 'HAM', 'Yokohama', 'Santos', 'Manzanillo'];
  for (let i = 1; i <= 140; i++) {
    const supplier = pick(SUPPLIERS, i, 5);
    const status = i % 31 === 0 ? 'Exception' : i % 9 === 0 ? 'At Port' : i % 6 === 0 ? 'In Transit' : 'Booked';
    const id = `page_com_po_${pad(i)}`;
    poIds.push(id);
    entities.pages[id] = page(
      id,
      `PO-${8800 + i} ${supplier}`,
      'db_commerce_purchase_orders',
      {
        PO: `PO-${8800 + i}`,
        Supplier: supplier,
        Status: status,
        Incoterm: i % 3 === 0 ? 'FOB' : i % 3 === 1 ? 'CIF' : 'EXW',
        OriginPort: pick(ports, i),
        Destination: pick(destinations, i),
        ETD: day(-10 + (i % 35)),
        ETA: day(12 + (i % 55)),
        Units: 800 + i * 37,
        ValueUSD: 12000 + i * 920,
        Risk: status === 'Exception' ? 'Docs mismatch' : i % 14 === 0 ? 'Late sailing' : 'None',
      },
      `# PO-${8800 + i} ${supplier}\n\nStatus: ${status}\nRoute: ${pick(ports, i)} to ${pick(destinations, i)}\nETA: ${day(12 + (i % 55))}\nRisk: ${status === 'Exception' ? 'Docs mismatch' : i % 14 === 0 ? 'Late sailing' : 'None'}`,
      -65 + (i % 50)
    );
  }

  const inventoryIds = [];
  const warehouses = ['US-LAX-3PL', 'US-NJ-FBA', 'DE-HAM-3PL', 'JP-KIX-FBA', 'BR-GRU-3PL', 'MX-MEX-3PL'];
  for (let i = 1; i <= 100; i++) {
    const product = entities.pages[pick(productIds, i * 2)];
    const available = 100 + ((i * 47) % 5200);
    const committed = 20 + ((i * 29) % 1800);
    const reorderPoint = 450 + ((i * 31) % 1200);
    const daysCover = Math.max(2, Math.round((available - committed) / (20 + (i % 70))));
    const status = daysCover < 10 ? 'Reorder Now' : daysCover < 21 ? 'Watch' : 'Healthy';
    const id = `page_com_inventory_${pad(i)}`;
    inventoryIds.push(id);
    entities.pages[id] = page(
      id,
      `Inventory ${product.properties.SKU} ${pick(warehouses, i)}`,
      'db_commerce_inventory',
      {
        SKU: product.properties.SKU,
        Warehouse: pick(warehouses, i),
        Available: available,
        Committed: committed,
        ReorderPoint: reorderPoint,
        DaysOfCover: daysCover,
        Status: status,
        Owner: pick(OWNERS, i, 5),
      },
      `# Inventory ${product.properties.SKU} ${pick(warehouses, i)}\n\nAvailable: ${available}\nCommitted: ${committed}\nDays of cover: ${daysCover}\nStatus: ${status}`,
      -50 + (i % 40)
    );
  }

  const campaignIds = [];
  const campaignTypes = ['Prime Day', 'Back to School', 'Holiday Prep', 'TikTok Bundle', 'New Arrival', 'Clearance'];
  for (let i = 1; i <= 60; i++) {
    const id = `page_com_campaign_${pad(i)}`;
    campaignIds.push(id);
    entities.pages[id] = page(
      id,
      `${pick(campaignTypes, i)} campaign ${pick(MARKETS, i)}`,
      'db_commerce_campaigns',
      {
        CampaignType: pick(campaignTypes, i),
        Market: pick(MARKETS, i),
        Channel: pick(CHANNELS, i),
        Status: i % 10 === 0 ? 'Blocked' : i % 4 === 0 ? 'Scheduled' : 'Planning',
        StartDate: day(5 + (i % 60)),
        BudgetUSD: 1500 + i * 320,
        Owner: pick(OWNERS, i, 6),
      },
      `# ${pick(campaignTypes, i)} campaign ${pick(MARKETS, i)}\n\nChannel: ${pick(CHANNELS, i)}\nBudget: ${1500 + i * 320}\nStatus: ${i % 10 === 0 ? 'Blocked' : i % 4 === 0 ? 'Scheduled' : 'Planning'}`,
      -40 + (i % 30)
    );
  }

  const issueIds = [];
  const issueTypes = ['late delivery', 'damaged package', 'wrong variant', 'missing manual', 'refund delay', 'listing mismatch'];
  for (let i = 1; i <= 75; i++) {
    const product = entities.pages[pick(productIds, i * 3)];
    const status = i % 12 === 0 ? 'Escalated' : i % 5 === 0 ? 'Waiting Supplier' : i % 4 === 0 ? 'Resolved' : 'Open';
    const id = `page_com_issue_${pad(i)}`;
    issueIds.push(id);
    entities.pages[id] = page(
      id,
      `Customer issue ${pad(i)} ${product.properties.SKU}`,
      'db_commerce_customer_issues',
      {
        SKU: product.properties.SKU,
        IssueType: pick(issueTypes, i),
        Status: status,
        Market: product.properties.Market,
        Channel: product.properties.Channel,
        Priority: i % 12 === 0 ? 1 : (i % 4) + 2,
        Owner: pick(OWNERS, i, 7),
        TicketCount: 1 + (i % 38),
      },
      `# Customer issue ${pad(i)} ${product.properties.SKU}\n\nIssue type: ${pick(issueTypes, i)}\nStatus: ${status}\nTicket count: ${1 + (i % 38)}\n\nSupport note: compare ticket trend with inventory, listing, and purchase-order records before escalating.`,
      -30 + (i % 25)
    );
  }

  entities.datasources.ds_commerce_products = datasource('ds_commerce_products', 'db_commerce_products', 'Commerce Product Catalog', {
    Name: { type: 'title' }, SKU: { type: 'rich_text' }, Status: { type: 'select' }, Channel: { type: 'select' },
    Market: { type: 'select' }, Category: { type: 'select' }, Supplier: { type: 'rich_text' },
    Owner: { type: 'people' }, LaunchDate: { type: 'date' }, GMV30d: { type: 'number' },
    MarginPct: { type: 'number' }, Priority: { type: 'number' }, RiskFlag: { type: 'select' },
  }, productIds);
  entities.datasources.ds_commerce_listing_ops = datasource('ds_commerce_listing_ops', 'db_commerce_listing_ops', 'Marketplace Listing Ops', {
    Name: { type: 'title' }, SourceSKU: { type: 'rich_text' }, Locale: { type: 'select' }, Channel: { type: 'select' },
    Status: { type: 'select' }, Defect: { type: 'select' }, Priority: { type: 'number' }, Owner: { type: 'people' }, DueDate: { type: 'date' },
  }, listingIds);
  entities.datasources.ds_commerce_suppliers = datasource('ds_commerce_suppliers', 'db_commerce_suppliers', 'Supplier Due Diligence', {
    Name: { type: 'title' }, Supplier: { type: 'rich_text' }, Country: { type: 'select' }, Category: { type: 'select' },
    CertificationStatus: { type: 'select' }, CertificateExpiry: { type: 'date' }, RiskTier: { type: 'select' },
    Owner: { type: 'people' }, LastReview: { type: 'date' }, RelatedSKUCount: { type: 'number' }, LaunchBlocker: { type: 'select' },
  }, supplierIds);
  entities.datasources.ds_commerce_purchase_orders = datasource('ds_commerce_purchase_orders', 'db_commerce_purchase_orders', 'Purchase Order Tracker', {
    Name: { type: 'title' }, PO: { type: 'rich_text' }, Supplier: { type: 'rich_text' }, Status: { type: 'select' },
    Incoterm: { type: 'select' }, OriginPort: { type: 'select' }, Destination: { type: 'select' }, ETD: { type: 'date' },
    ETA: { type: 'date' }, Units: { type: 'number' }, ValueUSD: { type: 'number' }, Risk: { type: 'rich_text' },
  }, poIds);
  entities.datasources.ds_commerce_inventory = datasource('ds_commerce_inventory', 'db_commerce_inventory', 'Inventory Replenishment', {
    Name: { type: 'title' }, SKU: { type: 'rich_text' }, Warehouse: { type: 'select' }, Available: { type: 'number' },
    Committed: { type: 'number' }, ReorderPoint: { type: 'number' }, DaysOfCover: { type: 'number' }, Status: { type: 'select' }, Owner: { type: 'people' },
  }, inventoryIds);
  entities.datasources.ds_commerce_campaigns = datasource('ds_commerce_campaigns', 'db_commerce_campaigns', 'Campaign Calendar', {
    Name: { type: 'title' }, CampaignType: { type: 'select' }, Market: { type: 'select' }, Channel: { type: 'select' },
    Status: { type: 'select' }, StartDate: { type: 'date' }, BudgetUSD: { type: 'number' }, Owner: { type: 'people' },
  }, campaignIds);
  entities.datasources.ds_commerce_customer_issues = datasource('ds_commerce_customer_issues', 'db_commerce_customer_issues', 'Customer Issue Queue', {
    Name: { type: 'title' }, SKU: { type: 'rich_text' }, IssueType: { type: 'select' }, Status: { type: 'select' },
    Market: { type: 'select' }, Channel: { type: 'select' }, Priority: { type: 'number' }, Owner: { type: 'people' }, TicketCount: { type: 'number' },
  }, issueIds);
  entities.datasources.ds_commerce_knowledge = datasource('ds_commerce_knowledge', 'db_commerce_knowledge', 'Commerce Knowledge Library', {
    Name: { type: 'title' }, Domain: { type: 'select' }, UseCase: { type: 'rich_text' }, Market: { type: 'select' },
    SourceType: { type: 'select' }, ReviewStatus: { type: 'select' }, Owner: { type: 'people' }, LastReviewed: { type: 'date' },
  }, knowledgeIds);

  for (let i = 1; i <= 50; i++) {
    const supplier = pick(SUPPLIERS, i);
    entities.files[`file_com_cert_${pad(i)}`] = file(
      `file_com_cert_${pad(i)}`,
      `supplier-cert-${slug(supplier)}-${pad(i)}.pdf`,
      'application/pdf',
      82000 + i * 1437,
      -90 + (i % 60)
    );
  }
  for (let i = 1; i <= 25; i++) {
    const product = entities.pages[pick(productIds, i * 5)];
    entities.files[`file_com_asset_${pad(i)}`] = file(
      `file_com_asset_${pad(i)}`,
      `${product.properties.SKU.toLowerCase()}-hero-image.jpg`,
      'image/jpeg',
      210000 + i * 7200,
      -45 + (i % 30)
    );
  }
  for (let i = 1; i <= 15; i++) {
    const content = `Commerce audit note ${pad(i)}\nOwner: ${pick(OWNERS, i)}\nFocus: ${pick(CATEGORIES, i)} ${pick(MARKETS, i)} launch readiness\n`;
    const id = `file_com_audit_note_${pad(i)}`;
    entities.files[id] = file(id, `commerce-audit-note-${pad(i)}.txt`, 'text/plain', Buffer.byteLength(content), -20 + i);
    fileBlobs[id] = Buffer.from(content).toString('base64');
  }

  addCommerceWorkers(entities, events);
  events.push(event('evt_commerce_profile_loaded', -120, 'workspace.profile.load', 'workspace', 'ws_mock_001', {
    profile: 'commerce',
    pages: Object.keys(entities.pages).length,
    datasources: Object.keys(entities.datasources).length,
    files: Object.keys(entities.files).length,
  }));

  return { entities, events, fileBlobs };
}
