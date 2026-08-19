const FIELDS = [
  // 类目与销售模式 (2)
  { name: 'category', label: '商品类目', section: '类目信息', type: 'text', required: true },
  { name: 'saleMode', label: '销售模式', section: '类目信息', type: 'text', required: true },

  // 国家/地区 (2)
  { name: 'selectedCountries', label: '已选国家/地区', section: '国家/地区', type: 'json', required: true },
  { name: 'countryPriceDiff', label: '国家差异价格', section: '国家/地区', type: 'json' },

  // 图片 (6)
  { name: 'image_1', label: '主图', section: '商品图片', type: 'file', required: true },
  { name: 'image_2', label: '图片2', section: '商品图片', type: 'file' },
  { name: 'image_3', label: '图片3', section: '商品图片', type: 'file' },
  { name: 'image_4', label: '图片4', section: '商品图片', type: 'file' },
  { name: 'image_5', label: '图片5', section: '商品图片', type: 'file' },
  { name: 'image_6', label: '图片6', section: '商品图片', type: 'file' },
  { name: 'video', label: '主图视频', section: '商品图片', type: 'file' },

  // 基础信息
  { name: 'productTitle', label: '商品名称', section: '基础信息', type: 'text', required: true },
  { name: 'keyword_1', label: '关键词1', section: '基础信息', type: 'textarea' },
  { name: 'keyword_2', label: '关键词2', section: '基础信息', type: 'textarea' },
  { name: 'keyword_3', label: '关键词3', section: '基础信息', type: 'textarea' },
  { name: 'productGroup', label: '商品分组', section: '基础信息', type: 'select' },
  { name: 'attr_usage', label: '用途', section: '商品属性', type: 'select' },
  { name: 'attr_productType', label: '产品类型', section: '商品属性', type: 'select' },
  { name: 'attr_instructions', label: '使用说明', section: '商品属性', type: 'select' },
  { name: 'attr_brand', label: '品牌', section: '商品属性', type: 'text' },
  { name: 'attr_model', label: '型号', section: '商品属性', type: 'text' },
  { name: 'attr_material', label: '材质', section: '商品属性', type: 'text' },
  { name: 'attr_diameter', label: '直径', section: '商品属性', type: 'text' },
  { name: 'attr_shape', label: '形状', section: '商品属性', type: 'text' },

  // 交易信息
  { name: 'saleType', label: '基础销售方式', section: '交易信息', type: 'select', required: true },
  { name: 'priceUnit', label: '计量单位', section: '交易信息', type: 'select', required: true },
  { name: 'priceMode', label: '价格类型', section: '交易信息', type: 'radio' },
  { name: 'ladderPrice', label: '阶梯价格', section: '交易信息', type: 'json' },
  { name: 'fobType', label: 'FOB类型', section: '交易信息', type: 'select' },
  { name: 'fobPriceMin', label: 'FOB最低价', section: '交易信息', type: 'text' },
  { name: 'fobPriceMax', label: 'FOB最高价', section: '交易信息', type: 'text' },
  { name: 'minOrderQuantity', label: '最小起订量', section: '交易信息', type: 'number' },
  { name: 'inventory', label: '可售数量', section: '交易信息', type: 'number' },
  { name: 'deliveryPeriod', label: '发货期', section: '交易信息', type: 'json', required: true },

  // 服务
  { name: 'productVisible', label: '私域品服务', section: '商品服务', type: 'radio' },

  // 描述
  { name: 'descType', label: '描述类型', section: '商品描述', type: 'radio' },
  { name: 'descriptionHtml', label: '商品描述内容', section: '商品描述', type: 'html' },

  // 协议
  { name: 'agreement', label: '发布协议', section: '发布协议', type: 'checkbox', required: true },
];

module.exports = FIELDS;
