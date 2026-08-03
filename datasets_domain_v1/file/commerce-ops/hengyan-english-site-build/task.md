帮恒燕起重（河北恒燕起重机械有限公司 / Hengyan）做一套英文版静态官网前端，给海外客户看的。整套是纯前端、离线实现：HTML / CSS / JS / SVG 全部本地化，别引用任何远程图片 / CDN / 字体，也没有真实后台可连。

文案和素材都在 `workspace/` 里。`site_content_brief.json` 是内容主来源——品牌、hero、6 款产品、案例、新闻、联系方式，以及一些边界声明都在里头，全站文案都从这里取；`brand_brief.md` 是品牌与业务背景；`xsyqz_layout_notes.md` 是对一个参考站的结构观察，照着布局思路走就行，别去访问那个真实站点。

`index.html` 用这些文案搭 HENGYAN 英文首页，包含 Home / About / Products / Cases / News / Contact 六个导航段落，产品区把 brief 里 6 款产品（Overhead Crane、Gantry Crane、Electric Hoist、Winch、Jib Crane、Crab Trolley）都列出来，并且只引用本地的 `css/style.css`、`js/script.js`、`assets/hero-lifting.svg`，页面里不能出现任何远程 URL。

样式要真的响应式——多个 `@media` 断点、grid / flex 现代布局，再带上 `:focus` 这类无障碍焦点样式。交互脚本 `js/script.js` 实现自定义鼠标跟随、产品类别筛选、询盘表单的客户端模拟提交（无真实后台）、以及键盘可达的组件。hero 插画 `assets/hero-lifting.svg` 画起重设备（crane / hook / hoist / beam 这些元素）。

网站是给海外客户看的，凡是本地材料撑不起来的高风险说法——CE / ISO / TUV / OSHA / UL 这类认证、年产能、专利数、客户名称——本地没有就一律别写，不能编。

另外两个 JSON 给我留档：`implementation_manifest.json` 记录各导航段落摘要（至少覆盖上面 6 个）、交互功能清单、本地依赖文件路径（`css/style.css`、`js/script.js`、`hero-lifting.svg`）、是否需要后台（不需要）、响应式策略和表单 mock 行为；`content_traceability.json` 记录页面实际用到的全部产品 / 案例 / 新闻 ID、引用了哪些源文件，以及主动排除了哪些本地材料撑不起来的高风险声明类型。

成品都写到 `outputs/` 下，最后只留这 6 个产物：`index.html`、`css/style.css`、`js/script.js`、`assets/hero-lifting.svg`、`implementation_manifest.json`、`content_traceability.json`（含 `css/`、`js/`、`assets/` 三个子目录），别留临时脚本或缓存。
