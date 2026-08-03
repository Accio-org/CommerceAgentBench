# Expected facts / LLM judge ground truth (file-commerce-ops-gpon-olt-topology-diagram v2)

## Subject

A pre-sales schematic showing a GPON OLT (mini-rack form factor) feeding 1 PON port through a TWO-STAGE optical splitter architecture (1:4 → 4×1:32) to deliver service to 128 ONUs in a residential area.

## Key topology facts

- **Architecture**: 1 PON port × 1:4 primary split × 4 secondaries × 1:32 each = 128 ONUs
- **Layout**: left-to-right (equipment room → splitters → residential)
- **Reference image**: `workspace/gpon_reference.jpg` shows the OLT device appearance (used for visual reference of the device shape)

## Required visible labels

Title: `GPON OLT 连接效果图`
Equipment room side: `机房`, `mini GPON OLT`, `PON-1`, `红色指示灯`
Splitter section: `一级分光器 1:4`, `二级分光器 1:32`, `4×1:32`
Fiber labels: `高速光纤`, `馈线光纤`, `配线光纤`, `×128`
Residential side: `住宅区`, `ONU` or `光猫`, `上网/WiFi`, `电视/TV`, `电话`

## Anti-cheat

- Do NOT collapse the architecture to a single `1:128` bubble — must show both stages
- Do NOT use external map tiles, CDN scripts, or remote images
- Do NOT add unsupported brand/performance/capacity claims beyond the 1:128 split
- Capacity math must explicitly show `1 × 4 × 32 = 128`

## Visual style expectations

- Tech-style flat / 2.5D isometric
- Light gray-blue tones
- Clean background, faint grid
- ≥3 building silhouettes on residential side
- Distinct fiber line styles (high-speed / feeder / distribution)
