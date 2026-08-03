#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
cd "${PROJECT_ROOT}/real_replica_bench/mock_services/stripe_cli"
S="bun bin/stripe"
rm -rf data
$S login >/dev/null 2>&1

gid() { grep '"id"' | head -1 | sed 's/.*: "//;s/".*//'; }

# === Products (7 needed, seeding 5 with errors + 2 junk) ===

# VoltGrid Basic — correct
P1=$($S products create --name="VoltGrid Basic" \
  --description="Single charging station management. Real-time monitoring, basic analytics, email alerts." \
  -d "metadata[tier]=basic" -d "metadata[stations]=1" 2>/dev/null | gid)
# WRONG monthly price 7900 instead of 8900
$S prices create --currency=usd --unit-amount=7900 -d "recurring[interval]=month" --product="$P1" >/dev/null 2>&1
$S prices create --currency=usd --unit-amount=89000 -d "recurring[interval]=year" --product="$P1" >/dev/null 2>&1

# VoltGrid Pro — WRONG name (should be Professional) + WRONG annual price
P2=$($S products create --name="VoltGrid Pro" \
  --description="Up to 10 stations. Advanced analytics, load balancing, mobile app, API access." \
  -d "metadata[tier]=professional" -d "metadata[stations]=10" 2>/dev/null | gid)
$S prices create --currency=usd --unit-amount=14900 -d "recurring[interval]=month" --product="$P2" >/dev/null 2>&1
# WRONG annual: 143000 instead of 149000
$S prices create --currency=usd --unit-amount=143000 -d "recurring[interval]=year" --product="$P2" >/dev/null 2>&1

# VoltGrid Fleet — WRONG metadata stations=50
P3=$($S products create --name="VoltGrid Fleet" \
  --description="Unlimited stations. Fleet management, route optimization, priority support, SLA guarantee." \
  -d "metadata[tier]=fleet" -d "metadata[stations]=50" 2>/dev/null | gid)
$S prices create --currency=usd --unit-amount=89900 -d "recurring[interval]=month" --product="$P3" >/dev/null 2>&1
$S prices create --currency=usd --unit-amount=899000 -d "recurring[interval]=year" --product="$P3" >/dev/null 2>&1

# Maintenance Add-on — correct
P4=$($S products create --name="Maintenance Add-on" \
  --description="Quarterly on-site maintenance inspection for each registered station." \
  -d "metadata[addon]=true" -d "metadata[frequency]=quarterly" 2>/dev/null | gid)
$S prices create --currency=usd --unit-amount=14900 -d "recurring[interval]=month" --product="$P4" >/dev/null 2>&1

# Hardware Warranty — WRONG description (missing "3-year")
P5=$($S products create --name="Hardware Warranty" \
  --description="Extended warranty for VoltGrid charging hardware. Covers parts and labor." \
  -d "metadata[addon]=true" -d "metadata[warranty_years]=3" 2>/dev/null | gid)
$S prices create --currency=usd --unit-amount=3900 -d "recurring[interval]=month" --product="$P5" >/dev/null 2>&1

# MISSING: Energy Analytics (#6), API Integration Pack (#7)
# JUNK products:
$S products create --name="Test Product DO NOT USE" --description="Testing" >/dev/null 2>&1
$S products create --name="Old Charger v1 (deprecated)" --description="Legacy product" >/dev/null 2>&1

# === Customers (5 needed, seeding 3 with some errors) ===
C1=$($S customers create --name="ChargeFast Inc" --email="billing@chargefast.io" \
  --description="Fleet customer — unlimited stations, annual billing" 2>/dev/null | gid)
# GreenDrive — WRONG email
C2=$($S customers create --name="GreenDrive LLC" --email="info@greendrive.com" \
  --description="Professional customer — 10 stations, monthly billing" 2>/dev/null | gid)
# ParkCharge — MISSING description + MISSING segment metadata
C3=$($S customers create --name="ParkCharge Systems" --email="finance@parkcharge.dev" 2>/dev/null | gid)
# MISSING: EcoFleet Partners, CityGrid Municipal

# === Coupons (3 needed, seeding 2 with errors + 1 junk) ===
$S coupons create --percent-off=10 --duration=repeating -d "duration_in_months=6" --name="EARLYBIRD" >/dev/null 2>&1
$S coupons create --percent-off=25 --duration=forever --name="FLEET25" >/dev/null 2>&1
# MISSING: HARDWARE10
# JUNK:
$S coupons create --percent-off=5 --duration=once --name="TESTDISCOUNT" >/dev/null 2>&1

# === Webhooks (3 needed, seeding 1) ===
$S webhook_endpoints create --url="https://api.voltgrid.com/webhooks/billing" \
  --enabled-events="invoice.paid" --description="Billing event notifications" >/dev/null 2>&1
# MISSING: fleet, analytics

# === Charges (4 needed, seeding 2 with 1 wrong) ===
# ChargeFast — WRONG amount 200000 instead of 250000
$S charges create --amount=200000 --currency=usd --source=tok_visa \
  --customer="$C1" --description="Fleet onboarding and hardware installation — ChargeFast Inc" >/dev/null 2>&1
# GreenDrive — correct
$S charges create --amount=75000 --currency=usd --source=tok_visa \
  --customer="$C2" --description="Professional setup and station configuration — GreenDrive LLC" >/dev/null 2>&1
# MISSING: EcoFleet, CityGrid charges

# === Subscriptions (8 needed, seeding 3) ===
# Get price IDs
FLEET_YEAR=$($S prices list 2>/dev/null | python3 -c "
import json,sys
for p in json.load(sys.stdin)['data']:
    if p.get('product')=='$P3' and p.get('unit_amount')==899000: print(p['id']); break")
PRO_MONTH=$($S prices list 2>/dev/null | python3 -c "
import json,sys
for p in json.load(sys.stdin)['data']:
    if p.get('product')=='$P2' and p.get('unit_amount')==14900: print(p['id']); break")
BASIC_MONTH=$($S prices list 2>/dev/null | python3 -c "
import json,sys
for p in json.load(sys.stdin)['data']:
    if p.get('product')=='$P1' and p.get('unit_amount')==7900: print(p['id']); break")

$S subscriptions create --customer="$C1" -d "items[0][price]=$FLEET_YEAR" >/dev/null 2>&1
$S subscriptions create --customer="$C2" -d "items[0][price]=$PRO_MONTH" >/dev/null 2>&1
$S subscriptions create --customer="$C3" -d "items[0][price]=$BASIC_MONTH" >/dev/null 2>&1
# MISSING: ChargeFast+API, GreenDrive+Analytics, ParkCharge+Maintenance, EcoFleet+Fleet, CityGrid+Pro

echo "=== Broken state seeded ==="
echo "Products: 7 exist (5 real + 2 junk), need 7 correct"
echo "Customers: 3 exist, need 5"
echo "Coupons: 3 exist (2 real wrong + 1 junk), need 3 correct"
echo "Webhooks: 1 exists, need 3"
echo "Charges: 2 exist (1 wrong), need 4"
echo "Subscriptions: 3 exist, need 8"
echo "Issues: wrong name, wrong prices(2), wrong meta, wrong desc, wrong email, missing desc,"
echo "  missing meta, wrong coupon, missing coupon, missing webhook(2), wrong charge, missing charge(2),"
echo "  missing customer(2), missing products(2), extra products(2), extra coupon, missing subs(5)"
