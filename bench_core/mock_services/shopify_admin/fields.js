// Shopify Admin mock 字段定义。
// 两个 page 各自独立的 schema：
//   product — Add Product 表单（30 字段）
//   theme   — Online Store 主题定制（38 字段，对应 themes-customize.html）

const PRODUCT_FIELDS = [
  // 基础信息 (2)
  { name: 'title', label: '产品标题', section: '基础信息', type: 'text', required: true },
  { name: 'description', label: '产品描述', section: '基础信息', type: 'html' },

  // 媒体 (6)
  { name: 'media_1', label: '主图', section: '媒体', type: 'file', required: true },
  { name: 'media_2', label: '图片2', section: '媒体', type: 'file' },
  { name: 'media_3', label: '图片3', section: '媒体', type: 'file' },
  { name: 'media_4', label: '图片4', section: '媒体', type: 'file' },
  { name: 'media_5', label: '图片5', section: '媒体', type: 'file' },
  { name: 'media_video', label: '产品视频', section: '媒体', type: 'file' },

  // 产品组织 (5)
  { name: 'category', label: '产品类目', section: '产品组织', type: 'text', required: true },
  { name: 'productType', label: '产品类型', section: '产品组织', type: 'text' },
  { name: 'vendor', label: '供应商', section: '产品组织', type: 'text' },
  { name: 'collections', label: '产品系列', section: '产品组织', type: 'json' },
  { name: 'tags', label: '产品标签', section: '产品组织', type: 'json' },

  // 定价 (4)
  { name: 'price', label: '价格', section: '定价', type: 'number', required: true },
  { name: 'compareAtPrice', label: '原价', section: '定价', type: 'number' },
  { name: 'costPerItem', label: '商品成本', section: '定价', type: 'number' },
  { name: 'chargeTax', label: '对此产品收税', section: '定价', type: 'checkbox' },

  // 库存 (4)
  { name: 'sku', label: 'SKU', section: '库存', type: 'text' },
  { name: 'barcode', label: '条形码', section: '库存', type: 'text' },
  { name: 'trackQuantity', label: '跟踪数量', section: '库存', type: 'checkbox' },
  { name: 'quantity', label: '可用数量', section: '库存', type: 'number' },

  // 运输 (3)
  { name: 'weight', label: '重量', section: '运输', type: 'number' },
  { name: 'weightUnit', label: '重量单位', section: '运输', type: 'select' },
  { name: 'countryOfOrigin', label: '原产地', section: '运输', type: 'select' },

  // 变体 (1)
  { name: 'variants', label: '产品变体', section: '变体', type: 'json' },

  // SEO (3)
  { name: 'seoTitle', label: '页面标题', section: 'SEO 搜索', type: 'text' },
  { name: 'seoDescription', label: '元描述', section: 'SEO 搜索', type: 'textarea' },
  { name: 'urlHandle', label: 'URL 句柄', section: 'SEO 搜索', type: 'text' },

  // 状态 (2)
  { name: 'status', label: '产品状态', section: '状态', type: 'radio', required: true },
  { name: 'salesChannels', label: '销售渠道', section: '状态', type: 'json' },
];

const THEME_FIELDS = [
  // 主题模板选择 (1)
  { name: 'themeTemplate', label: '主题版式', section: '主题版式', type: 'radio', required: true },

  // 业务信息 (5)
  { name: 'industry', label: '行业', section: '业务信息', type: 'select', required: true },
  { name: 'businessType', label: '业务类型', section: '业务信息', type: 'select' },
  { name: 'targetAudience', label: '目标客户', section: '业务信息', type: 'text' },
  { name: 'businessDescription', label: '业务描述', section: '业务信息', type: 'textarea' },
  { name: 'brandTone', label: '品牌调性', section: '业务信息', type: 'select' },

  // 主题与配色 (4)
  { name: 'theme', label: '排版主题', section: '主题与配色', type: 'radio', required: true },
  { name: 'colorScheme', label: '配色方案', section: '主题与配色', type: 'radio', required: true },
  { name: 'fontHeading', label: '标题字体', section: '主题与配色', type: 'select' },
  { name: 'fontBody', label: '正文字体', section: '主题与配色', type: 'select' },

  // 品牌信息 (5)
  { name: 'storeName', label: '店铺名称', section: '品牌信息', type: 'text', required: true },
  { name: 'logo', label: 'Logo', section: '品牌信息', type: 'file' },
  { name: 'slogan', label: '品牌标语', section: '品牌信息', type: 'text' },
  { name: 'brandColor', label: '品牌主色 (hex)', section: '品牌信息', type: 'text' },

  // Header & 公告栏 (3)
  { name: 'announcementText', label: '公告文字', section: 'Header & 公告栏', type: 'text' },
  { name: 'menuItems', label: '主导航菜单', section: 'Header & 公告栏', type: 'json' },
  { name: 'headerLayout', label: 'Header 布局', section: 'Header & 公告栏', type: 'radio' },

  // Hero Banner (4)
  { name: 'heroImage', label: 'Hero 背景图', section: 'Hero Banner', type: 'file', required: true },
  { name: 'heroHeading', label: 'Hero 标题', section: 'Hero Banner', type: 'text', required: true },
  { name: 'heroSubheading', label: 'Hero 副标题', section: 'Hero Banner', type: 'text' },
  { name: 'heroCTAText', label: '按钮文字', section: 'Hero Banner', type: 'text' },

  // 特色板块 (6)
  { name: 'featuredCollection', label: '推荐产品系列', section: '特色板块', type: 'text' },
  { name: 'products', label: '产品列表', section: '特色板块', type: 'json' },
  { name: 'valueProp1', label: '价值主张 1', section: '特色板块', type: 'text' },
  { name: 'valueProp2', label: '价值主张 2', section: '特色板块', type: 'text' },
  { name: 'valueProp3', label: '价值主张 3', section: '特色板块', type: 'text' },
  { name: 'richTextContent', label: '富文本介绍', section: '特色板块', type: 'textarea' },

  // Footer (2)
  { name: 'footerEmail', label: '联系邮箱', section: 'Footer', type: 'text' },
  { name: 'newsletterText', label: '邮件订阅文案', section: 'Footer', type: 'text' },

  // 发布 (2)
  { name: 'publishStatus', label: '发布状态', section: '发布', type: 'radio', required: true },
  { name: 'agreement', label: '同意主题协议', section: '发布', type: 'checkbox', required: true },

  // 高级 (1) — sectionsConfig 由编辑器维护
  { name: 'sectionsConfig', label: '分区配置', section: '高级', type: 'json' },
];

const FIELD_SETS = {
  product: PRODUCT_FIELDS,
  theme: THEME_FIELDS,
};

function getFields(page) {
  return FIELD_SETS[page] || PRODUCT_FIELDS;
}

function isValidPage(page) {
  return Object.prototype.hasOwnProperty.call(FIELD_SETS, page);
}

module.exports = PRODUCT_FIELDS;
module.exports.product = PRODUCT_FIELDS;
module.exports.theme = THEME_FIELDS;
module.exports.getFields = getFields;
module.exports.isValidPage = isValidPage;
module.exports.PAGES = Object.keys(FIELD_SETS);
