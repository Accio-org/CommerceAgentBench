# Citrus & Bloom — 品牌焕新内部简报

> 写给即将给我们做线上商店的 ops 同事。简报里同时夹了一些 marketing 灵感
> 和具体规格;实施时只要把"规格"那部分落到主题里就好,marketing tone 的
> 段落是为了让你理解我们想要什么样的氛围。

---

## 1 · 品牌氛围(只是 vibe,不用落地)

Citrus & Bloom 是一家做手作香氛蜡烛与扩香的小工作室,主推三条线:

- **Sunwash** — 柑橘 + 佛手柑,白天用,提神(主线)。
- **Moss Hour** — 苔藓 + 雪松,黄昏用,稳定情绪。
- **Linen Sky** — 茶花 + 棉花籽,睡前。

整体定位是"安静的明亮",**不要做成那种夕阳橙 + 黑色块的网红风**;
我们要传达的是"清晨阳光打在白墙、瓷砖、木桌"那种感觉。

参考 mood board 里的关键词:warm light, clean ceramic, paper-thin shadows。

---

## 2 · 视觉色卡(以下是会落到主题里的实际值)

| 用途 | 名字 | HEX |
|---|---|---|
| 主背景(整站底色) | "morning paper" | **#fff8f3** |
| 主文字 | "moss ink" | **#2f4a2b** |
| 主按钮底 / 强调色 | "sunwash orange" | **#ed8a3c** |

主按钮文字保持白色 / 接近白色即可,不在我们这次重点改的范围内。

---

## 3 · 字体

我们想要 serif heading + sans body 的经典组合。Heading 用 **Playfair Display**,body 用 **Inter**。
Theme 主题设置里都自带这两个字体,选下拉就行。

(注:不是 Cormorant 也不是 EB Garamond——
我们之前 sample 过那两款,heading 字距撑不开 logo 旁边的标语。)

---

## 4 · Logo 规格

- 主 logo 文件:`citrus_bloom_logo.png`(已经上传到 `workspace/images/`)。
- header 上的展示宽度规范:**180 px**(Shopify 主题里"Logo width"那个 slider)。
- 不用为 mobile 单独设另一个尺寸,主题会自适应。

## 5 · Favicon

- 用 `citrus_bloom_favicon.png` 上传。
- favicon 我们只关心"它存在",尺寸主题自己 crop。

---

## 6 · 不要做的事(避免 over-engineer)

- 不用碰 typography 里的 heading scale / body size,默认值就够。
- 不用动颜色 scheme 的 text gradient / button gradient(除非 UI 没办法保存)。
- 不用动 logo 的 alt 文案——主题默认 alt 已经写得没问题。
- 不要新建第二个 color scheme;只改默认的 Scheme 1。
- 改完务必走右上角"保存",别只 Discard 或者只到 draft 就走人——
  否则 saved 那一份就不会更新。
