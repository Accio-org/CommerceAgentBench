const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/images', express.static('images'));

const PORT = 3003;

const VALID_EMAIL = 'ops@globalfreight.com';
const VALID_PASSWORD = 'GF#Booking2026!';
const SESSION_COOKIE = 'freight_session';
const VALID_SESSION = 'frt_sess_8k3m7x9p2v_2026booking';

const QUOTES = [
  { id:'QT-2026-0701', seller:{name:'Xhipment',rating:4.2,reviews:58}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLAX',destCity:'Los Angeles', transitMin:22,transitMax:26,p2pMin:13,p2pMax:18, basePrice:5178.80, estDeparture:'May 27, 2026',estArrival:'Jun 12, 2026', rateExpiry:'May 31, 2026', badges:['Cheapest'], guaranteed:false },
  { id:'QT-2026-0702', seller:{name:'Seabay International Freight Forwarding Ltd',rating:4.7,reviews:1880}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLAX',destCity:'Los Angeles', transitMin:24,transitMax:29,p2pMin:15,p2pMax:20, basePrice:5655.90, estDeparture:'May 28, 2026',estArrival:'Jun 16, 2026', rateExpiry:'May 31, 2026', badges:['Top Logistics Provider','Guaranteed Capacity'], guaranteed:true },
  { id:'QT-2026-0703', seller:{name:'FORESMART FORWARDING LTD',rating:3.9,reviews:245}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLAX',destCity:'Los Angeles', transitMin:33,transitMax:39,p2pMin:24,p2pMax:30, basePrice:6885.96, estDeparture:'Jun 1, 2026',estArrival:'Jun 30, 2026', rateExpiry:'May 31, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0704', seller:{name:'C.H. Robinson',rating:4.5,reviews:520}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLAX',destCity:'Los Angeles', transitMin:19,transitMax:22,p2pMin:11,p2pMax:14, basePrice:6200.00, estDeparture:'May 26, 2026',estArrival:'Jun 7, 2026', rateExpiry:'May 28, 2026', badges:['Quickest'], guaranteed:true },
  { id:'QT-2026-0705', seller:{name:'Freight Right Global Logistics',rating:4.1,reviews:312}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLGB',destCity:'Long Beach', transitMin:25,transitMax:30,p2pMin:16,p2pMax:21, basePrice:5450.00, estDeparture:'May 28, 2026',estArrival:'Jun 17, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0706', seller:{name:'Phoenix International Freight Services',rating:4.0,reviews:89}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLGB',destCity:'Long Beach', transitMin:30,transitMax:35,p2pMin:21,p2pMax:26, basePrice:4980.00, estDeparture:'May 30, 2026',estArrival:'Jun 24, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0707', seller:{name:'Seabay International Freight Forwarding Ltd',rating:4.7,reviews:1880}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLAX',destCity:'Los Angeles', transitMin:21,transitMax:25,p2pMin:12,p2pMax:16, basePrice:5890.00, estDeparture:'May 27, 2026',estArrival:'Jun 11, 2026', rateExpiry:'May 31, 2026', badges:['Best Value'], guaranteed:true },
  { id:'QT-2026-0708', seller:{name:'Xhipment',rating:4.2,reviews:58}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLGB',destCity:'Long Beach', transitMin:26,transitMax:31,p2pMin:17,p2pMax:22, basePrice:5350.00, estDeparture:'May 27, 2026',estArrival:'Jun 17, 2026', rateExpiry:'May 31, 2026', badges:[], guaranteed:false },
  // Shenzhen → New York
  { id:'QT-2026-0801', seller:{name:'Maersk Line',rating:4.6,reviews:2450}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USNYC',destCity:'New York', transitMin:28,transitMax:35,p2pMin:20,p2pMax:27, basePrice:5850.00, estDeparture:'May 29, 2026',estArrival:'Jun 23, 2026', rateExpiry:'Jun 2, 2026', badges:['Top Carrier'], guaranteed:true },
  { id:'QT-2026-0802', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USNYC',destCity:'New York', transitMin:30,transitMax:38,p2pMin:22,p2pMax:30, basePrice:5200.00, estDeparture:'May 30, 2026',estArrival:'Jun 28, 2026', rateExpiry:'Jun 2, 2026', badges:['Cheapest'], guaranteed:false },
  { id:'QT-2026-0803', seller:{name:'Xhipment',rating:4.2,reviews:58}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USNWK',destCity:'Newark', transitMin:26,transitMax:32,p2pMin:18,p2pMax:24, basePrice:5650.00, estDeparture:'May 28, 2026',estArrival:'Jun 19, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0804', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USNYC',destCity:'New York', transitMin:25,transitMax:30,p2pMin:17,p2pMax:22, basePrice:6400.00, estDeparture:'May 27, 2026',estArrival:'Jun 16, 2026', rateExpiry:'May 30, 2026', badges:['Quickest'], guaranteed:true },
  // Shanghai → Hamburg
  { id:'QT-2026-0901', seller:{name:'Hapag-Lloyd',rating:4.5,reviews:1200}, originPort:'CNSHA',originCity:'Shanghai', destPort:'DEHAM',destCity:'Hamburg', transitMin:30,transitMax:36,p2pMin:22,p2pMax:28, basePrice:4800.00, estDeparture:'May 28, 2026',estArrival:'Jun 23, 2026', rateExpiry:'Jun 1, 2026', badges:['Cheapest'], guaranteed:false },
  { id:'QT-2026-0902', seller:{name:'MSC',rating:4.3,reviews:1650}, originPort:'CNSHA',originCity:'Shanghai', destPort:'DEHAM',destCity:'Hamburg', transitMin:28,transitMax:33,p2pMin:20,p2pMax:25, basePrice:5350.00, estDeparture:'May 27, 2026',estArrival:'Jun 19, 2026', rateExpiry:'May 31, 2026', badges:['Best Value'], guaranteed:true },
  { id:'QT-2026-0903', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNSHA',originCity:'Shanghai', destPort:'DEHAM',destCity:'Hamburg', transitMin:26,transitMax:30,p2pMin:18,p2pMax:22, basePrice:5900.00, estDeparture:'May 26, 2026',estArrival:'Jun 15, 2026', rateExpiry:'May 30, 2026', badges:['Quickest'], guaranteed:true },
  // Shenzhen → Hamburg
  { id:'QT-2026-0904', seller:{name:'Hapag-Lloyd',rating:4.5,reviews:1200}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'DEHAM',destCity:'Hamburg', transitMin:28,transitMax:34,p2pMin:20,p2pMax:26, basePrice:5100.00, estDeparture:'May 29, 2026',estArrival:'Jun 22, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0905', seller:{name:'MSC',rating:4.3,reviews:1650}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'DEHAM',destCity:'Hamburg', transitMin:26,transitMax:31,p2pMin:18,p2pMax:23, basePrice:5500.00, estDeparture:'May 28, 2026',estArrival:'Jun 18, 2026', rateExpiry:'May 31, 2026', badges:['Best Value'], guaranteed:true },
  // Ho Chi Minh → Los Angeles
  { id:'QT-2026-1001', seller:{name:'Yang Ming Marine',rating:4.1,reviews:340}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USLAX',destCity:'Los Angeles', transitMin:22,transitMax:28,p2pMin:14,p2pMax:20, basePrice:4600.00, estDeparture:'May 29, 2026',estArrival:'Jun 16, 2026', rateExpiry:'Jun 2, 2026', badges:['Cheapest'], guaranteed:false },
  { id:'QT-2026-1002', seller:{name:'ONE (Ocean Network Express)',rating:4.4,reviews:780}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USLAX',destCity:'Los Angeles', transitMin:20,transitMax:25,p2pMin:12,p2pMax:17, basePrice:5200.00, estDeparture:'May 27, 2026',estArrival:'Jun 11, 2026', rateExpiry:'Jun 1, 2026', badges:['Quickest','Best Value'], guaranteed:true },
  { id:'QT-2026-1003', seller:{name:'Seabay International',rating:4.7,reviews:1880}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USLGB',destCity:'Long Beach', transitMin:24,transitMax:30,p2pMin:16,p2pMax:22, basePrice:4900.00, estDeparture:'May 28, 2026',estArrival:'Jun 17, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  // Shenzhen → Los Angeles
  { id:'QT-2026-0811', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLAX',destCity:'Los Angeles', transitMin:22,transitMax:24,p2pMin:18,p2pMax:20, basePrice:4800.00, estDeparture:'May 28, 2026',estArrival:'Jun 11, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0812', seller:{name:'Maersk Line',rating:4.6,reviews:2450}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLAX',destCity:'Los Angeles', transitMin:19,transitMax:21,p2pMin:15,p2pMax:17, basePrice:5300.00, estDeparture:'May 27, 2026',estArrival:'Jun 7, 2026', rateExpiry:'May 31, 2026', badges:['Quickest'], guaranteed:true },
  // Shenzhen → Long Beach
  { id:'QT-2026-0813', seller:{name:'Yang Ming Marine',rating:4.1,reviews:340}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLGB',destCity:'Long Beach', transitMin:24,transitMax:26,p2pMin:20,p2pMax:22, basePrice:4500.00, estDeparture:'May 29, 2026',estArrival:'Jun 14, 2026', rateExpiry:'Jun 1, 2026', badges:['Cheapest'], guaranteed:false },
  // Guangzhou → Los Angeles
  { id:'QT-2026-0814', seller:{name:'MSC',rating:4.3,reviews:1650}, originPort:'CNGZH',originCity:'Guangzhou', destPort:'USLAX',destCity:'Los Angeles', transitMin:25,transitMax:27,p2pMin:21,p2pMax:23, basePrice:4600.00, estDeparture:'May 30, 2026',estArrival:'Jun 16, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  // Ho Chi Minh → New York
  { id:'QT-2026-1004', seller:{name:'Maersk Line',rating:4.6,reviews:2450}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USNYC',destCity:'New York', transitMin:30,transitMax:37,p2pMin:22,p2pMax:29, basePrice:5400.00, estDeparture:'May 30, 2026',estArrival:'Jun 26, 2026', rateExpiry:'Jun 2, 2026', badges:[], guaranteed:true },
  { id:'QT-2026-1005', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USNYC',destCity:'New York', transitMin:28,transitMax:34,p2pMin:20,p2pMax:26, basePrice:5800.00, estDeparture:'May 28, 2026',estArrival:'Jun 21, 2026', rateExpiry:'Jun 1, 2026', badges:['Quickest'], guaranteed:true },
  // === Additional quotes for route diversity ===
  // Shanghai → LA (add 3)
  { id:'QT-2026-0709', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLAX',destCity:'Los Angeles', transitMin:25,transitMax:29,p2pMin:17,p2pMax:21, basePrice:5500.00, estDeparture:'May 28, 2026',estArrival:'Jun 16, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0710', seller:{name:'Hapag-Lloyd',rating:4.5,reviews:1200}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLAX',destCity:'Los Angeles', transitMin:20,transitMax:24,p2pMin:12,p2pMax:16, basePrice:5900.00, estDeparture:'May 26, 2026',estArrival:'Jun 9, 2026', rateExpiry:'May 31, 2026', badges:[], guaranteed:true },
  { id:'QT-2026-0711', seller:{name:'ONE (Ocean Network Express)',rating:4.4,reviews:780}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLAX',destCity:'Los Angeles', transitMin:27,transitMax:32,p2pMin:19,p2pMax:24, basePrice:6100.00, estDeparture:'May 29, 2026',estArrival:'Jun 20, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  // Shanghai → Long Beach (add 2)
  { id:'QT-2026-0712', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLGB',destCity:'Long Beach', transitMin:24,transitMax:29,p2pMin:16,p2pMax:21, basePrice:5100.00, estDeparture:'May 28, 2026',estArrival:'Jun 16, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0713', seller:{name:'MSC',rating:4.3,reviews:1650}, originPort:'CNSHA',originCity:'Shanghai', destPort:'USLGB',destCity:'Long Beach', transitMin:27,transitMax:32,p2pMin:19,p2pMax:24, basePrice:5600.00, estDeparture:'May 30, 2026',estArrival:'Jun 21, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Ningbo → LA (add 2)
  { id:'QT-2026-0714', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLAX',destCity:'Los Angeles', transitMin:22,transitMax:26,p2pMin:14,p2pMax:18, basePrice:5600.00, estDeparture:'May 28, 2026',estArrival:'Jun 13, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0715', seller:{name:'Hapag-Lloyd',rating:4.5,reviews:1200}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLAX',destCity:'Los Angeles', transitMin:20,transitMax:24,p2pMin:12,p2pMax:16, basePrice:6100.00, estDeparture:'May 26, 2026',estArrival:'Jun 9, 2026', rateExpiry:'May 31, 2026', badges:[], guaranteed:true },
  // Ningbo → Long Beach (add 2)
  { id:'QT-2026-0716', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLGB',destCity:'Long Beach', transitMin:23,transitMax:28,p2pMin:15,p2pMax:20, basePrice:5200.00, estDeparture:'May 28, 2026',estArrival:'Jun 15, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0717', seller:{name:'MSC',rating:4.3,reviews:1650}, originPort:'CNNGB',originCity:'Ningbo', destPort:'USLGB',destCity:'Long Beach', transitMin:26,transitMax:31,p2pMin:18,p2pMax:23, basePrice:4850.00, estDeparture:'May 30, 2026',estArrival:'Jun 20, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Shenzhen → LA (add 2)
  { id:'QT-2026-0815', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLAX',destCity:'Los Angeles', transitMin:23,transitMax:26,p2pMin:19,p2pMax:22, basePrice:5100.00, estDeparture:'May 28, 2026',estArrival:'Jun 13, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0816', seller:{name:'ONE (Ocean Network Express)',rating:4.4,reviews:780}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLAX',destCity:'Los Angeles', transitMin:20,transitMax:23,p2pMin:16,p2pMax:19, basePrice:5500.00, estDeparture:'May 27, 2026',estArrival:'Jun 9, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Shenzhen → Long Beach (add 2, all more expensive than Yang Ming $4,500)
  { id:'QT-2026-0817', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLGB',destCity:'Long Beach', transitMin:23,transitMax:27,p2pMin:19,p2pMax:23, basePrice:4700.00, estDeparture:'May 28, 2026',estArrival:'Jun 14, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0818', seller:{name:'Seabay International',rating:4.7,reviews:1880}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USLGB',destCity:'Long Beach', transitMin:21,transitMax:25,p2pMin:17,p2pMax:21, basePrice:5100.00, estDeparture:'May 27, 2026',estArrival:'Jun 11, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Shenzhen → NY (add 2, totals above QT-0801's $6,404 to keep top-3 unchanged)
  { id:'QT-2026-0805', seller:{name:'Hapag-Lloyd',rating:4.5,reviews:1200}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USNYC',destCity:'New York', transitMin:28,transitMax:33,p2pMin:20,p2pMax:25, basePrice:6000.00, estDeparture:'May 29, 2026',estArrival:'Jun 21, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0806', seller:{name:'ONE (Ocean Network Express)',rating:4.4,reviews:780}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'USNYC',destCity:'New York', transitMin:27,transitMax:32,p2pMin:19,p2pMax:24, basePrice:6200.00, estDeparture:'May 28, 2026',estArrival:'Jun 19, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Shenzhen → Hamburg (add 1)
  { id:'QT-2026-0906', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'CNYTN',originCity:'Shenzhen', destPort:'DEHAM',destCity:'Hamburg', transitMin:27,transitMax:32,p2pMin:19,p2pMax:24, basePrice:5300.00, estDeparture:'May 29, 2026',estArrival:'Jun 20, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  // Guangzhou → LA (add 2)
  { id:'QT-2026-0819', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'CNGZH',originCity:'Guangzhou', destPort:'USLAX',destCity:'Los Angeles', transitMin:24,transitMax:28,p2pMin:20,p2pMax:24, basePrice:4900.00, estDeparture:'May 29, 2026',estArrival:'Jun 16, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:false },
  { id:'QT-2026-0820', seller:{name:'Evergreen Marine',rating:4.4,reviews:670}, originPort:'CNGZH',originCity:'Guangzhou', destPort:'USLAX',destCity:'Los Angeles', transitMin:23,transitMax:26,p2pMin:19,p2pMax:22, basePrice:5200.00, estDeparture:'May 28, 2026',estArrival:'Jun 13, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Ho Chi Minh → LA (add 1)
  { id:'QT-2026-1006', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USLAX',destCity:'Los Angeles', transitMin:23,transitMax:27,p2pMin:15,p2pMax:19, basePrice:4800.00, estDeparture:'May 29, 2026',estArrival:'Jun 15, 2026', rateExpiry:'Jun 2, 2026', badges:[], guaranteed:false },
  // Ho Chi Minh → Long Beach (add 1)
  { id:'QT-2026-1007', seller:{name:'Maersk Line',rating:4.6,reviews:2450}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USLGB',destCity:'Long Beach', transitMin:21,transitMax:26,p2pMin:13,p2pMax:18, basePrice:5100.00, estDeparture:'May 27, 2026',estArrival:'Jun 12, 2026', rateExpiry:'Jun 1, 2026', badges:[], guaranteed:true },
  // Ho Chi Minh → NY (add 1)
  { id:'QT-2026-1008', seller:{name:'COSCO Shipping',rating:4.3,reviews:890}, originPort:'VNSGN',originCity:'Ho Chi Minh City', destPort:'USNYC',destCity:'New York', transitMin:30,transitMax:36,p2pMin:22,p2pMax:28, basePrice:5200.00, estDeparture:'May 30, 2026',estArrival:'Jun 25, 2026', rateExpiry:'Jun 2, 2026', badges:[], guaranteed:false }
];

// ============================================================
// ROUTE DATA — fixed city/port mappings
// ============================================================
const CITIES = {
  CN: [
    { value:'hangzhou', label:'Hangzhou, Zhejiang' },
    { value:'shanghai', label:'Shanghai' },
    { value:'shenzhen', label:'Shenzhen, Guangdong' },
    { value:'ningbo',   label:'Ningbo, Zhejiang' },
    { value:'guangzhou',label:'Guangzhou, Guangdong' },
  ],
  US: [
    { value:'losangeles', label:'Los Angeles, CA' },
    { value:'newyork',    label:'New York, NY' },
    { value:'longbeach',  label:'Long Beach, CA' },
    { value:'chicago',    label:'Chicago, IL' },
  ],
  DE: [
    { value:'hamburg',     label:'Hamburg' },
    { value:'bremerhaven', label:'Bremerhaven' },
  ],
  GB: [
    { value:'felixstowe', label:'Felixstowe' },
    { value:'london',     label:'London' },
  ],
  NL: [
    { value:'rotterdam', label:'Rotterdam' },
  ],
  VN: [
    { value:'hochiminh', label:'Ho Chi Minh City' },
    { value:'haiphong',  label:'Hai Phong' },
  ],
  JP: [
    { value:'tokyo', label:'Tokyo' },
    { value:'osaka', label:'Osaka' },
  ],
};

const PORTS = {
  CN: [
    { value:'CNSHA', label:'CNSHA - Shanghai' },
    { value:'CNNGB', label:'CNNGB - Ningbo' },
    { value:'CNYTN', label:'CNYTN - Shenzhen Yantian' },
    { value:'CNSHE', label:'CNSHE - Shenzhen Shekou' },
    { value:'CNGZH', label:'CNGZH - Guangzhou' },
  ],
  US: [
    { value:'USLAX', label:'USLAX - Los Angeles' },
    { value:'USLGB', label:'USLGB - Long Beach' },
    { value:'USNYC', label:'USNYC - New York' },
    { value:'USNWK', label:'USNWK - Newark' },
    { value:'USCHI', label:'USCHI - Chicago' },
  ],
  DE: [
    { value:'DEHAM', label:'DEHAM - Hamburg' },
    { value:'DEBRV', label:'DEBRV - Bremerhaven' },
  ],
  GB: [
    { value:'GBFXT', label:'GBFXT - Felixstowe' },
    { value:'GBLON', label:'GBLON - London' },
  ],
  NL: [
    { value:'NLRTM', label:'NLRTM - Rotterdam' },
  ],
  VN: [
    { value:'VNSGN', label:'VNSGN - Ho Chi Minh City' },
    { value:'VNHPH', label:'VNHPH - Hai Phong' },
  ],
  JP: [
    { value:'JPTYO', label:'JPTYO - Tokyo' },
    { value:'JPOSA', label:'JPOSA - Osaka' },
  ],
};

const CITY_PORTS = {
  hangzhou:['CNSHA','CNNGB'], shanghai:['CNSHA'], shenzhen:['CNYTN','CNSHE'],
  ningbo:['CNNGB'], guangzhou:['CNGZH','CNYTN'],
  losangeles:['USLAX'], longbeach:['USLGB'], newyork:['USNYC','USNWK'], chicago:['USCHI'],
  hamburg:['DEHAM'], bremerhaven:['DEBRV','DEHAM'],
  rotterdam:['NLRTM'],
  felixstowe:['GBFXT'], london:['GBFXT','GBLON'],
  hochiminh:['VNSGN'], haiphong:['VNHPH'],
  tokyo:['JPTYO'], osaka:['JPOSA'],
};

function selectedPorts(data, prefix) {
  const type = data[`${prefix}Type`];
  const value = data[`${prefix}City`];
  if (type === 'port') return value ? [value] : [];
  return CITY_PORTS[value] || [];
}

function filterQuotes(searchData) {
  const data = searchData || {};
  const oPorts = selectedPorts(data, 'origin');
  const dPorts = selectedPorts(data, 'dest');
  if (!oPorts.length || !dPorts.length) return QUOTES;
  return QUOTES.filter(q => oPorts.includes(q.originPort) && dPorts.includes(q.destPort));
}

const sessionStore = {};
const accessLog = [];
const VERIFIER_TOKEN = process.env.MOCK_VERIFIER_TOKEN || '';

const NON_BROWSER_UA = /(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|go-http-client|java|ruby|php|libwww|okhttp|postmanruntime)/i;
const BROWSER_UA = /(mozilla|chrome|chromium|safari|firefox|edg|headlesschrome)/i;
const UI_WRITE_PATHS = new Set(['/login', '/search', '/services', '/select-quote', '/confirm', '/verification']);

function classifyBrowserClient(req) {
  const ua = req.get('user-agent') || '';
  const accept = req.get('accept') || '';
  const secFetchMode = req.get('sec-fetch-mode') || '';
  const secFetchDest = req.get('sec-fetch-dest') || '';
  if (!ua) return 'missing user-agent';
  if (NON_BROWSER_UA.test(ua)) return 'programmatic user-agent';
  if (!BROWSER_UA.test(ua)) return 'non-browser user-agent';
  if (req.method === 'GET' && !accept.includes('text/html') && secFetchDest !== 'document') {
    return 'non-browser navigation headers';
  }
  if (req.method === 'POST' && !accept.includes('text/html') && secFetchMode !== 'navigate') {
    return 'non-browser form headers';
  }
  return '';
}

function denyNonBrowser(req, res, reason) {
  accessLog.push({
    path: req.path,
    method: req.method,
    time: new Date().toISOString(),
    blocked: true,
    reason,
    userAgent: String(req.get('user-agent') || '').slice(0, 160),
  });
  return res.status(403).type('text/plain').send('Access Denied: automated HTTP clients, including curl and web fetch, are not permitted to retrieve this protected page. Please open the URL in a browser.\n');
}

function requireBrowserClient(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/api/') || req.path.startsWith('/images/')) return next();
  if (req.path === '/favicon.ico') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return next();
  if (req.method === 'POST' && !UI_WRITE_PATHS.has(req.path)) return next();
  const reason = classifyBrowserClient(req);
  if (reason) return denyNonBrowser(req, res, reason);
  return next();
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'logistics_tracker' }));
app.use(requireBrowserClient);

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function tokenEquals(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function uiToken(session, key) {
  session.uiTokens = session.uiTokens || {};
  if (!session.uiTokens[key]) session.uiTokens[key] = newToken();
  return session.uiTokens[key];
}

function hiddenUiToken(session, key) {
  return `<input type="hidden" name="ui_token" value="${uiToken(session, key)}">`;
}

function requireUiToken(key) {
  return (req, res, next) => {
    const expected = req.session && req.session.uiTokens && req.session.uiTokens[key];
    const ok = expected && tokenEquals(req.body.ui_token, expected);
    accessLog.push({
      path: req.path,
      method: req.method,
      time: new Date().toISOString(),
      uiTokenKey: key,
      uiTokenValid: !!ok,
    });
    if (!ok) {
      return res.status(403).send(pageShell(
        'Browser Required',
        '<div class="card"><div class="card-body"><div class="card-title">Browser form required</div><p>This workflow step must be submitted from the current browser page. Open the FreightOS UI in the browser and use the on-page form instead of raw HTTP POST.</p></div></div>',
        true,
        null
      ));
    }
    delete req.body.ui_token;
    return next();
  };
}

function requireVerifierToken(req, res, next) {
  const provided = req.get('x-mock-verifier-token') || req.query.token || '';
  if (!VERIFIER_TOKEN || !tokenEquals(provided, VERIFIER_TOKEN)) {
    accessLog.push({
      path: req.path,
      method: req.method,
      time: new Date().toISOString(),
      blocked: true,
      reason: 'verifier-token-required',
      userAgent: String(req.get('user-agent') || '').slice(0, 160),
    });
    return res.status(403).json({
      error: 'verifier_only',
      message: 'This endpoint is reserved for the benchmark verifier. Use the browser UI for the FreightOS workflow.',
    });
  }
  return next();
}

function getSession(req) {
  const t = req.cookies[SESSION_COOKIE];
  return (t && sessionStore[t]) ? sessionStore[t] : null;
}
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.redirect('/login');
  req.session = s;
  accessLog.push({ path: req.path, method: req.method, time: new Date().toISOString() });
  next();
}
function requireStep(min) {
  return (req, res, next) => {
    if (req.session.step < min) {
      const r = [null,'/search','/services','/results','/booking','/verification'];
      return res.redirect(r[req.session.step] || '/search');
    }
    next();
  };
}
function calcTotalPrice(q, sv) {
  const ins = sv.insurance ? Math.round(sv.goodsValue * 0.0042 * 100) / 100 : 0;
  const cust = sv.customs ? 275 : 0;
  const bond = sv.customs ? (sv.bondType === 'annual' ? 500 : 65) : 0;
  const pf = Math.round(q.basePrice * 0.015 * 100) / 100;
  return { freight:q.basePrice, insurance:ins, customs:cust, bond:bond, platformFee:pf, total:Math.round((q.basePrice+ins+cust+bond+pf)*100)/100 };
}
function fmtPrice(n) { return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ============================================================
// CSS — Freightos Design System
// ============================================================
function sharedCSS() { return `
:root {
  --primary: #2075BD;
  --primary-dark: #125C9B;
  --primary-darkest: #05387D;
  --primary-light: #e8f4fd;
  --green: #47A96E;
  --green-bg: #e6f7ee;
  --red: #D8271E;
  --orange: #faad14;
  --orange-bg: #fffbe6;
  --teal-bg: #E0F5F9;
  --bg: #F5F5F7;
  --white: #fff;
  --border: #eee;
  --border-mid: #DCE0E6;
  --gray-icon: #8DABC4;
  --gray-text: #676767;
  --gray-placeholder: #AEB8C2;
  --gray-muted: #999;
  --text: #333;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  --shadow-card: 0 2px 8px rgba(0,0,0,0.09);
  --shadow-hover: 0 4px 16px rgba(0,0,0,0.12);
  --radius: 4px;
  --radius-lg: 8px;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:14px;line-height:1.57;}
a{color:var(--primary);text-decoration:none;}
a:hover{text-decoration:underline;}
hr{border:none;border-top:1px solid var(--border);margin:16px 0;}
img{max-width:100%;}

/* ---- HEADER ---- */
.site-header{background:var(--white);border-bottom:1px solid var(--border);height:56px;display:flex;align-items:center;padding:0 24px;position:sticky;top:0;z-index:100;}
.site-header .logo{display:flex;align-items:center;gap:8px;font-size:20px;font-weight:700;color:var(--primary-dark);letter-spacing:-0.5px;}
.site-header .logo svg{width:28px;height:28px;}
.site-header .logo em{font-style:normal;color:var(--primary);font-weight:800;}
.site-header nav{margin-left:auto;display:flex;align-items:center;gap:16px;}
.site-header nav a{color:var(--gray-text);font-size:13px;padding:4px 8px;border-radius:var(--radius);transition:background .15s;}
.site-header nav a:hover{background:var(--bg);text-decoration:none;}
.header-avatar{width:32px;height:32px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;}
.header-email{font-size:12px;color:var(--gray-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ---- STEP PROGRESS ---- */
.step-progress{display:flex;align-items:center;justify-content:center;padding:20px 20px 0;margin-bottom:24px;}
.sp-step{display:flex;align-items:center;}
.sp-circle{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;border:2px solid var(--border-mid);color:var(--gray-placeholder);background:var(--white);}
.sp-circle.done{background:var(--green);border-color:var(--green);color:#fff;}
.sp-circle.active{background:var(--primary);border-color:var(--primary);color:#fff;}
.sp-text{margin-left:6px;font-size:12px;color:var(--gray-placeholder);white-space:nowrap;}
.sp-text.done{color:var(--green);}
.sp-text.active{color:var(--primary);font-weight:600;}
.sp-line{width:56px;height:2px;background:var(--border-mid);margin:0 8px;flex-shrink:0;}
.sp-line.done{background:var(--green);}

/* ---- LAYOUT ---- */
.page-container{max-width:1160px;margin:0 auto;padding:0 24px 48px;}
.page-narrow{max-width:480px;margin:0 auto;padding:24px;}

/* ---- CARDS ---- */
.card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-card);}
.card-body{padding:24px;}
.card-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:16px;}

/* ---- FORMS (Ant Design style) ---- */
.form-item{margin-bottom:16px;}
.form-item label{display:block;font-size:14px;color:var(--text);margin-bottom:4px;}
.form-item label .req{color:var(--red);margin-left:2px;}
.ant-input,.ant-select{width:100%;height:36px;padding:6px 12px;border:1px solid #d9d9d9;border-radius:var(--radius);font-size:14px;font-family:var(--font);background:var(--white);color:var(--text);transition:border-color .15s,box-shadow .15s;outline:none;}
.ant-input:focus,.ant-select:focus{border-color:var(--primary);box-shadow:0 0 0 2px rgba(32,117,189,0.2);}
.ant-input::placeholder{color:var(--gray-placeholder);}
.ant-textarea{height:auto;min-height:80px;resize:vertical;}
.ant-checkbox{margin-right:8px;width:16px;height:16px;accent-color:var(--primary);}
.ant-radio{margin-right:6px;accent-color:var(--primary);}
.form-row{display:flex;gap:16px;}
.form-row > *{flex:1;}
.form-row-3{display:flex;gap:16px;}
.form-row-3 > *{flex:1;}

/* ---- BUTTONS ---- */
.ant-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 20px;border:1px solid #d9d9d9;border-radius:var(--radius);font-size:14px;font-weight:400;cursor:pointer;background:var(--white);color:var(--text);font-family:var(--font);transition:all .15s;line-height:1.57;}
.ant-btn:hover{color:var(--primary);border-color:var(--primary);}
.ant-btn-primary{background:var(--primary);border-color:var(--primary);color:#fff;font-weight:500;}
.ant-btn-primary:hover{background:var(--primary-dark);border-color:var(--primary-dark);color:#fff;}
.ant-btn-lg{padding:10px 28px;font-size:16px;height:44px;}
.ant-btn-block{width:100%;}
.ant-btn-ghost{background:transparent;border-color:var(--primary);color:var(--primary);}
.ant-btn-link{background:none;border:none;color:var(--primary);padding:0;box-shadow:none;}

/* ---- SWITCH (toggle) ---- */
.ant-switch{position:relative;display:inline-block;width:44px;height:22px;border-radius:100px;background:#bfbfbf;cursor:pointer;transition:background .2s;vertical-align:middle;}
.ant-switch input{display:none;}
.ant-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.15);transition:left .2s;}
.ant-switch.checked{background:var(--primary);}
.ant-switch.checked::after{left:24px;}

/* ---- CHIPS / TAGS ---- */
.chip{display:inline-block;padding:2px 10px;border-radius:2px;font-size:12px;font-weight:500;line-height:20px;}
.chip-primary{background:var(--primary-light);color:var(--primary);}
.chip-green{background:var(--green-bg);color:var(--green);}
.chip-orange{background:var(--orange-bg);color:#d48806;border:1px solid #ffe58f;}
.chip-gold{background:#fffbe6;color:#d4a017;border:1px solid #f0e68c;}

/* ---- ALERT ---- */
.ant-alert{padding:12px 16px;border-radius:var(--radius);display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;font-size:14px;line-height:1.5;}
.ant-alert-info{background:var(--teal-bg);border:1px solid #b5e8f0;color:#0d5875;}
.ant-alert-warning{background:var(--orange-bg);border:1px solid #ffe58f;color:#8d6e00;}
.ant-alert-error{background:#fff2f0;border:1px solid #ffccc7;color:var(--red);}
.ant-alert svg{flex-shrink:0;margin-top:2px;}

/* ---- RESULTS LAYOUT ---- */
.results-layout{display:flex;gap:0;min-height:calc(100vh - 130px);}
.results-sider{width:240px;flex-shrink:0;background:var(--white);border-right:1px solid var(--border);padding:20px 16px;overflow-y:auto;position:sticky;top:56px;max-height:calc(100vh - 56px);}
.results-main{flex:1;padding:20px 24px;}
.filter-section{margin-bottom:20px;}
.filter-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;}
.filter-title svg{width:12px;height:12px;fill:var(--gray-icon);transition:transform .2s;}
.filter-item{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;color:var(--gray-text);}
.filter-item .count{color:var(--gray-muted);font-size:12px;}
.filter-range{font-size:12px;color:var(--gray-text);padding:4px 0;}

/* ---- SORT TABS ---- */
.sort-tabs{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;}
.sort-tab{padding:12px 20px;cursor:pointer;font-size:13px;color:var(--gray-text);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;text-align:center;min-width:120px;}
.sort-tab:hover{color:var(--primary);}
.sort-tab.active{color:var(--primary);border-bottom-color:var(--primary);font-weight:600;}
.sort-tab .sort-sub{font-size:11px;color:var(--gray-muted);margin-top:2px;}
.sort-tab.active .sort-sub{color:var(--primary);opacity:0.7;}

/* ---- QUOTE TILE ---- */
.quote-tile{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:12px;transition:box-shadow .15s,border-color .15s;overflow:hidden;}
.quote-tile:hover{box-shadow:var(--shadow-hover);border-color:#c0d8ec;}
.quote-tile-body{padding:16px 20px;}
.quote-chips{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;}
.quote-summary{display:flex;align-items:stretch;}
.quote-main{flex:1;}
.quote-side{width:160px;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;padding-left:20px;border-left:1px solid var(--border);margin-left:20px;}

/* Route visualization */
.route-vis{display:flex;align-items:center;gap:0;margin:8px 0 12px;padding:8px 0;}
.route-point{text-align:center;min-width:70px;}
.route-point .port{font-size:13px;font-weight:600;color:var(--text);}
.route-point .city{font-size:11px;color:var(--gray-text);}
.route-connector{flex:1;display:flex;align-items:center;justify-content:center;position:relative;height:24px;margin:0 4px;}
.route-connector::before{content:'';position:absolute;top:50%;left:0;right:0;height:2px;background:repeating-linear-gradient(90deg,var(--gray-icon) 0,var(--gray-icon) 6px,transparent 6px,transparent 10px);}
.route-icon{position:relative;z-index:1;background:var(--white);padding:0 6px;font-size:16px;line-height:1;}
.route-mode{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--gray-text);margin-bottom:4px;}
.route-mode svg{width:18px;height:18px;fill:var(--primary);}
.quote-route-context{font-size:12px;color:var(--gray-text);background:var(--primary-light);border-radius:var(--radius);padding:8px 10px;margin:8px 0 6px;line-height:1.45;}
.quote-route-context strong{color:var(--primary-dark);}

/* Quote details grid */
.quote-details{display:flex;gap:24px;margin-top:8px;}
.quote-detail-item{font-size:12px;}
.quote-detail-item .detail-label{color:var(--gray-muted);text-transform:uppercase;letter-spacing:0.3px;font-size:10px;display:block;}
.quote-detail-item .detail-value{font-weight:500;color:var(--text);font-size:13px;}
.quote-vendor{font-size:12px;color:var(--gray-text);margin-top:8px;padding-top:8px;border-top:1px solid var(--border);}
.quote-vendor strong{color:var(--text);}
.quote-stars{color:#faad14;}
.quote-price{font-size:22px;font-weight:700;color:var(--text);}
.quote-price .decimals{font-size:14px;vertical-align:super;}
.quote-price-label{font-size:10px;color:var(--gray-muted);text-align:right;margin-bottom:8px;}

/* ---- TWO COLUMN ---- */
.two-col{display:flex;gap:24px;align-items:flex-start;}
.two-col .col-main{flex:2;}
.two-col .col-side{flex:1;position:sticky;top:100px;}

/* ---- PRICE TABLE ---- */
.price-table{width:100%;}
.price-table td{padding:8px 0;font-size:14px;vertical-align:top;}
.price-table td:last-child{text-align:right;font-weight:500;white-space:nowrap;}
.price-table .sub td{color:var(--gray-text);font-size:13px;}
.price-table .total-row td{border-top:2px solid var(--text);padding-top:12px;font-size:18px;font-weight:700;color:var(--primary-dark);}
.price-table .muted td{color:var(--gray-muted);font-size:12px;}

/* ---- BOOKING ROUTE (Ant Steps style) ---- */
.booking-route{display:flex;align-items:center;gap:0;margin:16px 0;padding:12px 0;}
.booking-route-step{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:60px;}
.booking-route-step .icon{width:36px;height:36px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:16px;}
.booking-route-step .label{font-size:11px;color:var(--gray-text);margin-top:4px;max-width:80px;line-height:1.3;}
.booking-route-step .label strong{color:var(--text);font-size:12px;}
.booking-route-tail{flex:1;height:2px;background:var(--primary);opacity:0.3;margin:0 -4px;margin-top:-16px;}

/* ---- VERIFICATION ---- */
.verif-layout{display:flex;gap:0;min-height:calc(100vh - 130px);}
.verif-sidebar{width:260px;flex-shrink:0;background:var(--white);border-right:1px solid var(--border);padding:24px 16px;}
.verif-main{flex:1;padding:24px 32px;}
.verif-header{background:var(--white);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.verif-header h2{font-size:18px;font-weight:600;margin:0;}
.verif-progress{width:100%;height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-top:8px;}
.verif-progress-bar{height:100%;background:var(--primary);border-radius:3px;transition:width .3s;}
.sidebar-menu-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--radius);font-size:13px;color:var(--gray-text);cursor:default;margin-bottom:2px;}
.sidebar-menu-item.active{background:var(--primary-light);color:var(--primary);font-weight:500;}
.sidebar-menu-item .menu-icon{width:20px;height:20px;border-radius:50%;border:2px solid var(--border-mid);display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}
.sidebar-menu-item .menu-icon.done{background:var(--green);border-color:var(--green);color:#fff;}

/* ---- LOGIN ---- */
.login-bg{min-height:calc(100vh - 56px);display:flex;align-items:center;justify-content:center;background:var(--bg);}
.login-card{width:400px;padding:40px;text-align:center;}
.login-card h2{color:var(--primary-dark);font-size:24px;margin-bottom:6px;}
.login-card .sub{color:var(--gray-text);font-size:14px;margin-bottom:28px;}
.login-error{background:#fff2f0;border:1px solid #ffccc7;color:var(--red);padding:8px 12px;border-radius:var(--radius);margin-bottom:16px;font-size:13px;text-align:left;}

/* ---- HERO ---- */
.hero{background:linear-gradient(135deg,var(--primary) 0%,var(--primary-dark) 100%);color:#fff;border-radius:var(--radius-lg);padding:32px;text-align:center;margin-bottom:24px;}
.hero h2{font-size:22px;margin-bottom:6px;font-weight:600;}
.hero p{opacity:0.85;font-size:14px;}

/* ---- SEARCH CATEGORIES ---- */
.search-categories{display:flex;gap:1px;background:var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-card);}
.search-cat{flex:1;background:var(--white);padding:16px 20px;cursor:pointer;transition:background .15s;border-bottom:3px solid transparent;}
.search-cat:hover{background:#fafbfc;}
.search-cat.active{border-bottom-color:var(--primary);background:#fafbfc;}
.search-cat h4{font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:6px;}
.search-cat h4 svg{width:14px;height:14px;fill:var(--primary);}
.search-cat p{font-size:12px;color:var(--gray-placeholder);margin:0;}
.search-form-panel{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-card);padding:24px;margin-bottom:16px;}
.search-form-panel h3{font-size:15px;font-weight:600;color:var(--primary-dark);margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);}

/* ---- SERVICE OPTION ---- */
.service-option{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--border);}
.service-option:last-child{border-bottom:none;}
.service-info{flex:1;}
.service-info h4{font-size:15px;font-weight:500;margin-bottom:4px;}
.service-info p{font-size:13px;color:var(--gray-text);margin:0;}

/* ---- RADIO CARDS ---- */
.radio-cards{display:flex;gap:12px;margin-top:12px;}
.radio-card{flex:1;border:2px solid var(--border);border-radius:var(--radius-lg);padding:16px;cursor:pointer;transition:border-color .15s;}
.radio-card:hover{border-color:var(--primary);}
.radio-card input[type="radio"]:checked ~ .rc-content{color:var(--primary);}
.radio-card:has(input:checked){border-color:var(--primary);background:var(--primary-light);}
.rc-title{font-size:14px;font-weight:500;margin-bottom:4px;}
.rc-desc{font-size:12px;color:var(--gray-text);}

/* ---- COMPLETION ---- */
.completion{text-align:center;padding:48px 24px;}
.completion .icon{font-size:56px;margin-bottom:16px;}
.completion h2{color:var(--green);font-size:22px;margin-bottom:8px;}
.completion p{color:var(--gray-text);margin-bottom:20px;}

/* ---- CHECK ITEM ---- */
.check-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;}
.check-item label{font-size:13px;color:var(--gray-text);line-height:1.5;cursor:pointer;}

/* ---- FOOTER ---- */
.site-footer{text-align:center;padding:24px;font-size:12px;color:var(--gray-muted);border-top:1px solid var(--border);background:var(--white);}

/* ---- SUMMARY STRIP ---- */
.summary-strip{display:flex;gap:1px;background:var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:20px;box-shadow:var(--shadow-card);}
.summary-strip .ss-item{background:var(--white);padding:12px 16px;flex:1;}
.summary-strip .ss-label{font-size:10px;color:var(--gray-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;}
.summary-strip .ss-value{font-size:13px;font-weight:500;}

@media(max-width:768px){
  .form-row,.form-row-3{flex-direction:column;}
  .two-col{flex-direction:column;}
  .results-layout,.verif-layout{flex-direction:column;}
  .results-sider,.verif-sidebar{width:100%;position:static;}
  .quote-summary{flex-direction:column;}
  .quote-side{width:100%;border-left:none;padding-left:0;margin-left:0;border-top:1px solid var(--border);padding-top:12px;margin-top:12px;flex-direction:row;align-items:center;}
  .summary-strip{flex-direction:column;}
}
`; }

// ============================================================
// SHARED COMPONENTS
// ============================================================
const SHIP_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17h18v2H3v-2zm1-3l1.5 2h13L20 14l-3-1-4 2-4-2-3 1z" fill="#2075BD"/><path d="M6 9h12v5H6z" fill="none" stroke="#2075BD" stroke-width="1.2"/></svg>';

function renderHeader(session) {
  const nav = session
    ? `<nav>
        <a href="/search">Find a Quote</a>
        <a href="/route-planner">Route Planner</a>
        <a href="/shipments">Shipments</a>
        <div class="header-avatar">${VALID_EMAIL[0].toUpperCase()}</div>
        <span class="header-email">${VALID_EMAIL}</span>
       </nav>`
    : `<nav><a href="/login" class="ant-btn ant-btn-primary" style="font-size:13px;padding:4px 16px;">Log In</a></nav>`;
  return `<header class="site-header">
    <div class="logo">
      <svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="6" width="28" height="20" rx="3" fill="#2075BD"/><path d="M8 12h16M8 17h12" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="17" r="2" fill="#fff"/></svg>
      Freight<em>OS</em>
    </div>
    ${nav}
  </header>`;
}

function renderStepProgress(current) {
  const steps = ['Search','Services','Results','Booking','Verification'];
  return `<div class="step-progress">${steps.map((s,i) => {
    const n = i+1;
    const cls = n < current ? 'done' : n === current ? 'active' : '';
    const icon = n < current ? '&#10003;' : n;
    const line = i < steps.length-1 ? `<div class="sp-line${n < current ? ' done' : ''}"></div>` : '';
    return `<div class="sp-step"><div class="sp-circle ${cls}">${icon}</div><span class="sp-text ${cls}">${s}</span></div>${line}`;
  }).join('')}</div>`;
}

function pageShell(title, body, session, step) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - FreightOS</title><style>${sharedCSS()}</style></head><body>${renderHeader(session)}${step ? renderStepProgress(step) : ''}<div class="page-container">${body}</div><footer class="site-footer">&copy; 2011-2026 FreightOS Ltd &nbsp;|&nbsp; MSA &nbsp;|&nbsp; Terms &nbsp;|&nbsp; Privacy &nbsp;|&nbsp; API Developer &nbsp;|&nbsp; US: +1 888 727 0239</footer></body></html>`;
}

const COUNTRIES = `<option value="">Select country</option><option value="CN">China</option><option value="US">United States</option><option value="GB">United Kingdom</option><option value="DE">Germany</option><option value="JP">Japan</option><option value="KR">South Korea</option><option value="IN">India</option><option value="VN">Vietnam</option><option value="TH">Thailand</option><option value="MY">Malaysia</option><option value="SG">Singapore</option><option value="AU">Australia</option><option value="CA">Canada</option><option value="MX">Mexico</option><option value="BR">Brazil</option><option value="FR">France</option><option value="IT">Italy</option><option value="ES">Spain</option><option value="NL">Netherlands</option><option value="TR">Turkey</option>`;

// ============================================================
// LOGIN
// ============================================================
app.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/search');
  res.send(renderLoginPage());
});
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === VALID_EMAIL && password === VALID_PASSWORD) {
    sessionStore[VALID_SESSION] = { step:1, searchData:null, servicesData:null, selectedQuoteId:null, bookingConfirmed:false, shipmentId:null, verificationData:null, completedAt:null, uiTokens:{} };
    accessLog.push({ path:'/login', method:'POST', time:new Date().toISOString(), success:true });
    res.cookie(SESSION_COOKIE, VALID_SESSION, { httpOnly:true, path:'/' });
    return res.redirect('/search');
  }
  accessLog.push({ path:'/login', method:'POST', time:new Date().toISOString(), success:false });
  res.send(renderLoginPage('Invalid email or password.'));
});
function renderLoginPage(error) {
  const err = error ? `<div class="login-error">${error}</div>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Log In - FreightOS</title><style>${sharedCSS()}</style></head><body>${renderHeader(null)}<div class="login-bg"><div class="card login-card"><h2>FreightOS</h2><p class="sub">Compare, book and manage your freight</p>${err}<form method="POST" action="/login" style="text-align:left;"><div class="form-item"><label for="email">Email address</label><input class="ant-input" type="email" id="email" name="email" placeholder="Enter your email" required></div><div class="form-item"><label for="password">Password</label><input class="ant-input" type="password" id="password" name="password" placeholder="Enter your password" required></div><button type="submit" class="ant-btn ant-btn-primary ant-btn-lg ant-btn-block" style="margin-top:8px;">Log In</button></form><p style="margin-top:20px;font-size:12px;color:var(--gray-muted);">Trusted by 10,000+ importers worldwide</p></div></div><footer class="site-footer">&copy; 2011-2026 FreightOS Ltd</footer></body></html>`;
}

// ============================================================
// SEARCH (STEP 1)
// ============================================================
app.get('/', requireAuth, (req, res) => res.redirect('/search'));
app.get('/search', requireAuth, (req, res) => res.send(renderSearchPage(req.session)));
app.post('/search', requireAuth, requireUiToken('search'), (req, res) => {
  const d = req.body;
  const originOptions = d.origin_type === 'port' ? (PORTS[d.origin_country]||[]) : (CITIES[d.origin_country]||[]);
  const destOptions = d.dest_type === 'port' ? (PORTS[d.dest_country]||[]) : (CITIES[d.dest_country]||[]);
  const originCityLabel = originOptions.find(c=>c.value===d.origin_city);
  const destCityLabel = destOptions.find(c=>c.value===d.dest_city);
  req.session.searchData = { originType:d.origin_type||'', originCountry:d.origin_country||'', originCity:d.origin_city||'', originCityLabel:originCityLabel?originCityLabel.label:d.origin_city||'', destType:d.dest_type||'', destCountry:d.dest_country||'', destCity:d.dest_city||'', destCityLabel:destCityLabel?destCityLabel.label:d.dest_city||'', cargoType:d.cargo_type||'', containerSize:d.container_size||'', containerQty:parseInt(d.container_qty)||1, goodsValue:parseFloat(d.goods_value)||0, goodsDescription:d.goods_description||'', hazardous:d.hazardous==='on', goodsReady:d.goods_ready||'' };
  req.session.step = Math.max(req.session.step, 2);
  res.redirect('/services');
});

function renderSearchPage(session) {
  const body = `
<div class="hero"><h2>Where would you like to ship?</h2><p>Start searching to compare, book and manage your freight, all on one platform</p></div>
<form method="POST" action="/search">
  ${hiddenUiToken(session, 'search')}
  <div class="search-form-panel">
    <h3>
      <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="10" r="3" fill="#2075BD"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="none" stroke="#2075BD" stroke-width="1.5"/></svg>
      Origin — Where are you shipping from?
    </h3>
    <div class="form-row-3">
      <div class="form-item"><label for="origin_type">Location Type</label><select class="ant-select" id="origin_type" name="origin_type" onchange="updateLocationOptions('origin_type','origin_country','origin_city','origin_location_label')"><option value="port">Port / Airport</option><option value="business">Business Pickup Address</option></select></div>
      <div class="form-item"><label for="origin_country">Country<span class="req">*</span></label><select class="ant-select" id="origin_country" name="origin_country" onchange="updateLocationOptions('origin_type','origin_country','origin_city','origin_location_label')">${COUNTRIES}</select></div>
      <div class="form-item"><label for="origin_city"><span id="origin_location_label">Port</span><span class="req">*</span></label><select class="ant-select" id="origin_city" name="origin_city"><option value="">— Select country first —</option></select></div>
    </div>
  </div>
  <div class="search-form-panel">
    <h3>
      <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="10" r="3" fill="#D8271E"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="none" stroke="#D8271E" stroke-width="1.5"/></svg>
      Destination — Where are you shipping to?
    </h3>
    <div class="form-row-3">
      <div class="form-item"><label for="dest_type">Location Type</label><select class="ant-select" id="dest_type" name="dest_type" onchange="updateLocationOptions('dest_type','dest_country','dest_city','dest_location_label')"><option value="port">Port / Airport</option><option value="business">Business Delivery Address</option></select></div>
      <div class="form-item"><label for="dest_country">Country<span class="req">*</span></label><select class="ant-select" id="dest_country" name="dest_country" onchange="updateLocationOptions('dest_type','dest_country','dest_city','dest_location_label')">${COUNTRIES}</select></div>
      <div class="form-item"><label for="dest_city"><span id="dest_location_label">Port</span><span class="req">*</span></label><select class="ant-select" id="dest_city" name="dest_city"><option value="">— Select country first —</option></select></div>
    </div>
  </div>
  <div class="search-form-panel">
    <h3>
      <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;margin-right:4px;"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" fill="none" stroke="#2075BD" stroke-width="1.5"/></svg>
      Load — What are you shipping?
    </h3>
    <div class="form-row-3">
      <div class="form-item"><label for="cargo_type">Cargo Type<span class="req">*</span></label><select class="ant-select" id="cargo_type" name="cargo_type"><option value="fcl">Full Container Load (FCL)</option><option value="lcl">Less than Container Load (LCL)</option><option value="air">Air Freight</option></select></div>
      <div class="form-item"><label for="container_size">Container Size</label><select class="ant-select" id="container_size" name="container_size"><option value="20">20' Standard</option><option value="40">40' Standard</option><option value="40hc">40' High Cube</option><option value="45hc">45' High Cube</option></select></div>
      <div class="form-item"><label for="container_qty"># of Containers</label><input class="ant-input" type="number" id="container_qty" name="container_qty" value="1" min="1" max="50"></div>
    </div>
  </div>
  <div class="search-form-panel">
    <h3>
      <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:middle;margin-right:4px;"><rect x="3" y="7" width="18" height="10" rx="2" fill="none" stroke="#2075BD" stroke-width="1.5"/><path d="M12 4v3M6 4v3M18 4v3M12 17v3M6 17v3M18 17v3" stroke="#2075BD" stroke-width="1.2"/></svg>
      Goods — Tell us about your goods
    </h3>
    <div class="form-row">
      <div class="form-item"><label for="goods_value">Goods Value (USD)<span class="req">*</span></label><input class="ant-input" type="number" id="goods_value" name="goods_value" placeholder="Enter total value" step="0.01" min="0"></div>
      <div class="form-item"><label for="goods_description">Commodity Description</label><input class="ant-input" id="goods_description" name="goods_description" placeholder="e.g., Consumer Electronics, Textiles"></div>
    </div>
    <div class="form-row">
      <div class="form-item"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" class="ant-checkbox" id="hazardous" name="hazardous">Contains hazardous materials</label></div>
      <div class="form-item"><label for="goods_ready">Are your goods ready?</label><select class="ant-select" id="goods_ready" name="goods_ready"><option value="ready">Yes, goods are ready</option><option value="1week">Within 1 week</option><option value="2weeks">Within 2 weeks</option><option value="flexible">Flexible</option></select></div>
    </div>
  </div>
  <div style="text-align:center;margin-top:8px;">
    <button type="submit" class="ant-btn ant-btn-primary ant-btn-lg" style="min-width:260px;">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      Search for Quotes
    </button>
  </div>
</form>
<script>
var CITY_DATA = ${JSON.stringify(CITIES)};
var PORT_DATA = ${JSON.stringify(PORTS)};
function updateLocationOptions(typeId, countryId, cityId, labelId) {
  var type = document.getElementById(typeId).value;
  var country = document.getElementById(countryId).value;
  var citySelect = document.getElementById(cityId);
  var label = document.getElementById(labelId);
  var isPort = type === 'port';
  if (label) label.textContent = isPort ? 'Port' : 'City';
  citySelect.innerHTML = '';
  var options = (isPort ? PORT_DATA : CITY_DATA)[country];
  if (!options || !options.length) {
    citySelect.innerHTML = '<option value="">— No ' + (isPort ? 'ports' : 'cities') + ' available —</option>';
    return;
  }
  citySelect.innerHTML = '<option value="">— Select ' + (isPort ? 'port' : 'city') + ' —</option>';
  options.forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    citySelect.appendChild(opt);
  });
}
</script>`;
  return pageShell('Search', body, true, 1);
}

// ============================================================
// SERVICES (STEP 2)
// ============================================================
app.get('/services', requireAuth, requireStep(2), (req, res) => res.send(renderServicesPage(req.session)));
app.post('/services', requireAuth, requireStep(2), requireUiToken('services'), (req, res) => {
  const d = req.body;
  req.session.servicesData = { insurance:d.insurance==='on', customs:d.customs==='on', bondType:d.bond_type||'single', goodsValue:req.session.searchData?req.session.searchData.goodsValue:0 };
  req.session.step = Math.max(req.session.step, 3);
  res.redirect('/results');
});

function renderServicesPage(session) {
  const sd = session.searchData || {};
  const body = `
<div class="summary-strip">
  <div class="ss-item"><div class="ss-label">Origin</div><div class="ss-value">${sd.originCityLabel||sd.originCity||'-'}, ${sd.originCountry||'-'}</div></div>
  <div class="ss-item"><div class="ss-label">Destination</div><div class="ss-value">${sd.destCityLabel||sd.destCity||'-'}, ${sd.destCountry||'-'}</div></div>
  <div class="ss-item"><div class="ss-label">Load</div><div class="ss-value">${sd.containerQty||1} &times; ${sd.containerSize||'40'}' ${sd.cargoType==='fcl'?'FCL':sd.cargoType||'FCL'}</div></div>
  <div class="ss-item"><div class="ss-label">Goods</div><div class="ss-value">$${(sd.goodsValue||0).toLocaleString()} &middot; ${sd.goodsReady==='ready'?'Ready':sd.goodsReady||'-'}</div></div>
</div>
<div class="card"><div class="card-body">
  <div class="card-title">Recommended Services</div>
  <p style="color:var(--gray-text);margin-bottom:20px;">We've selected the services you need to ship your goods. Review and confirm before getting results.</p>
  <form method="POST" action="/services">
    ${hiddenUiToken(session, 'services')}
    <div class="service-option">
      <div class="service-info"><h4>Transport Insurance</h4><p>Covers the combined value of goods and freight costs up to $500,000</p></div>
      <label class="ant-switch checked" onclick="this.classList.toggle('checked');this.querySelector('input').checked=this.classList.contains('checked')"><input type="checkbox" name="insurance" checked style="display:none"></label>
    </div>
    <div class="service-option">
      <div class="service-info"><h4>Customs Brokerage &amp; Bond (US Import)</h4><p>Licensed customs broker to handle import clearance and documentation</p></div>
      <label class="ant-switch checked" onclick="this.classList.toggle('checked');this.querySelector('input').checked=this.classList.contains('checked')"><input type="checkbox" name="customs" checked style="display:none"></label>
    </div>
    <div style="padding:16px 0;">
      <label style="font-size:14px;font-weight:500;margin-bottom:8px;display:block;">Customs Bond Type</label>
      <div class="radio-cards">
        <label class="radio-card"><input type="radio" name="bond_type" value="single" checked style="margin-right:8px;accent-color:var(--primary)"><div class="rc-content"><div class="rc-title">Single Entry Bond — from $65</div><div class="rc-desc">Single-use bond. Best for infrequent shipments.</div></div></label>
        <label class="radio-card"><input type="radio" name="bond_type" value="annual" style="margin-right:8px;accent-color:var(--primary)"><div class="rc-content"><div class="rc-title">Annual Bond — $500</div><div class="rc-desc">Valid for 12 months. Best for frequent importers.</div></div></label>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;">
      <a href="/search" class="ant-btn">Back</a>
      <button type="submit" class="ant-btn ant-btn-primary ant-btn-lg">Confirm Services &amp; Get Results</button>
    </div>
  </form>
</div></div>`;
  return pageShell('Recommended Services', body, true, 2);
}

// ============================================================
// RESULTS (STEP 3)
// ============================================================
app.get('/results', requireAuth, requireStep(3), (req, res) => res.send(renderResultsPage(req.session, req.query.sort||'best')));
app.post('/select-quote', requireAuth, requireStep(3), requireUiToken('select-quote'), (req, res) => {
  const q = QUOTES.find(q => q.id === req.body.quote_id);
  if (!q) return res.redirect('/results');
  req.session.selectedQuoteId = req.body.quote_id;
  req.session.step = Math.max(req.session.step, 4);
  res.redirect('/booking');
});

function renderResultsPage(session, sortBy) {
  const sd = session.searchData || {};
  const sv = session.servicesData || { insurance:true, customs:true, bondType:'single', goodsValue:0 };
  sv.goodsValue = session.searchData ? session.searchData.goodsValue : 0;
  let sorted = filterQuotes(sd).map(q => ({ ...q, pricing: calcTotalPrice(q, sv) }));
  if (sortBy==='cheapest') sorted.sort((a,b)=>a.pricing.total-b.pricing.total);
  else if (sortBy==='quickest') sorted.sort((a,b)=>a.transitMin-b.transitMin);
  else sorted.sort((a,b)=>(a.pricing.total/((a.transitMin+a.transitMax)/2))-(b.pricing.total/((b.transitMin+b.transitMax)/2)));

  if (sorted.length === 0) {
    const noResults = `<div class="results-main">
      <div class="summary-strip" style="margin-bottom:16px;">
        <div class="ss-item"><div class="ss-label">Origin</div><div class="ss-value">${sd.originCityLabel||sd.originCity||'-'}, ${sd.originCountry||'-'}</div></div>
        <div class="ss-item"><div class="ss-label">Destination</div><div class="ss-value">${sd.destCityLabel||sd.destCity||'-'}, ${sd.destCountry||'-'}</div></div>
        <div class="ss-item"><div class="ss-label">Load</div><div class="ss-value">${sd.containerQty||1} × ${sd.containerSize||'40'}' FCL</div></div>
        <div class="ss-item"><div class="ss-label">Goods</div><div class="ss-value">$${(sd.goodsValue||0).toLocaleString()}</div></div>
      </div>
      <div class="card"><div class="card-body" style="text-align:center;padding:48px 24px;">
        <div style="font-size:48px;margin-bottom:16px;">🔍</div>
        <h3 style="margin-bottom:8px;">No Quotes Available</h3>
        <p style="color:var(--gray-text);">We couldn't find any quotes for this route. Please try a different origin or destination.</p>
        <a href="/search" class="ant-btn ant-btn-primary" style="margin-top:16px;">Modify Search</a>
      </div></div>
    </div>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Results - FreightOS</title><style>${sharedCSS()}</style></head><body>${renderHeader(true)}${renderStepProgress(3)}<div class="results-layout"><div class="results-sider"><div style="font-size:15px;font-weight:600;">0 Quotes</div><div style="font-size:12px;color:var(--gray-muted);margin-top:4px;">No results for this route</div></div>${noResults}</div><footer class="site-footer">&copy; 2011-2026 FreightOS Ltd</footer></body></html>`;
  }

  const bestQ = [...sorted].sort((a,b)=>(a.pricing.total/((a.transitMin+a.transitMax)/2))-(b.pricing.total/((b.transitMin+b.transitMax)/2)))[0];
  const cheapQ = [...sorted].sort((a,b)=>a.pricing.total-b.pricing.total)[0];
  const fastQ = [...sorted].sort((a,b)=>a.transitMin-b.transitMin)[0];

  // Seller filter counts
  const sellerCounts = {};
  sorted.forEach(q => { sellerCounts[q.seller.name] = (sellerCounts[q.seller.name]||0)+1; });
  const portCounts = { origin:{}, dest:{} };
  sorted.forEach(q => { portCounts.origin[q.originPort]=(portCounts.origin[q.originPort]||0)+1; portCounts.dest[q.destPort]=(portCounts.dest[q.destPort]||0)+1; });

  const sidebar = `
<div class="results-sider">
  <div style="font-size:15px;font-weight:600;margin-bottom:4px;">Top ${sorted.length} Quotes</div>
  <div style="font-size:12px;color:var(--gray-muted);margin-bottom:16px;">${sorted.length} results found</div>
  <div class="filter-section">
    <div class="filter-title">Price <svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg></div>
    <div class="filter-range">$${fmtPrice(Math.min(...sorted.map(q=>q.pricing.total)))} – $${fmtPrice(Math.max(...sorted.map(q=>q.pricing.total)))}</div>
  </div>
  <div class="filter-section">
    <div class="filter-title">Seller <svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg></div>
    ${Object.entries(sellerCounts).map(([name,cnt]) => `<div class="filter-item"><input type="checkbox" class="ant-checkbox" checked disabled><span>${name.length>25?name.slice(0,25)+'…':name}</span><span class="count">(${cnt})</span></div>`).join('')}
  </div>
  <div class="filter-section">
    <div class="filter-title">Origin Port <svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg></div>
    ${Object.entries(portCounts.origin).map(([p,c]) => `<div class="filter-item"><input type="checkbox" class="ant-checkbox" checked disabled><span>${p}</span><span class="count">(${c})</span></div>`).join('')}
  </div>
  <div class="filter-section">
    <div class="filter-title">Destination Port <svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg></div>
    ${Object.entries(portCounts.dest).map(([p,c]) => `<div class="filter-item"><input type="checkbox" class="ant-checkbox" checked disabled><span>${p}</span><span class="count">(${c})</span></div>`).join('')}
  </div>
</div>`;

  const tabActive = t => t===sortBy ? ' active' : '';
  const sortTabs = `
<div class="sort-tabs">
  <a href="/results?sort=best" class="sort-tab${tabActive('best')}">Best Value<div class="sort-sub">${bestQ.transitMin}-${bestQ.transitMax}d · $${fmtPrice(bestQ.pricing.total)}</div></a>
  <a href="/results?sort=quickest" class="sort-tab${tabActive('quickest')}">Quickest<div class="sort-sub">${fastQ.transitMin}-${fastQ.transitMax}d · $${fmtPrice(fastQ.pricing.total)}</div></a>
  <a href="/results?sort=cheapest" class="sort-tab${tabActive('cheapest')}">Cheapest<div class="sort-sub">${cheapQ.transitMin}-${cheapQ.transitMax}d · $${fmtPrice(cheapQ.pricing.total)}</div></a>
</div>`;

  const quoteCards = sorted.map(q => {
    const badges = q.badges.map(b => {
      const cls = b==='Cheapest'?'chip-green':b==='Quickest'?'chip-primary':b.includes('Guaranteed')?'chip-orange':'chip-gold';
      return `<span class="chip ${cls}">${b}</span>`;
    }).join('');
    const stars = '★'.repeat(Math.floor(q.seller.rating)) + (q.seller.rating%1>=0.5?'☆':'');
    const [whole, dec] = fmtPrice(q.pricing.total).split('.');
    return `
<div class="quote-tile" data-quote-id="${q.id}"><div class="quote-tile-body">
  ${badges?`<div class="quote-chips">${badges}</div>`:''}
  <div class="quote-summary">
    <div class="quote-main">
      <div class="route-mode">${SHIP_SVG}<span>Ocean leg inside a door-to-door quote</span></div>
      <div class="quote-route-context">Pickup <strong>${sd.originCityLabel||sd.originCity||'-'}</strong> &rarr; origin port <strong>${q.originPort} ${q.originCity}</strong>; destination port <strong>${q.destPort} ${q.destCity}</strong> &rarr; delivery <strong>${sd.destCityLabel||sd.destCity||'-'}</strong>.</div>
      <div class="route-vis">
        <div class="route-point"><div class="port">${q.originPort}</div><div class="city">${q.originCity}</div></div>
        <div class="route-connector"><span class="route-icon">🚢</span></div>
        <div class="route-point"><div class="port">${q.destPort}</div><div class="city">${q.destCity}</div></div>
      </div>
      <div class="quote-details">
        <div class="quote-detail-item"><span class="detail-label">Quote ID</span><span class="detail-value">${q.id}</span></div>
        <div class="quote-detail-item"><span class="detail-label">Transit</span><span class="detail-value">${q.transitMin}-${q.transitMax} days</span></div>
        <div class="quote-detail-item"><span class="detail-label">Port-to-Port</span><span class="detail-value">${q.p2pMin}-${q.p2pMax} days</span></div>
        <div class="quote-detail-item"><span class="detail-label">Est. Departure</span><span class="detail-value">${q.estDeparture}</span></div>
        <div class="quote-detail-item"><span class="detail-label">Est. Arrival</span><span class="detail-value">${q.estArrival}</span></div>
      </div>
      <div class="quote-vendor"><strong>${q.seller.name}</strong> &nbsp;<span class="quote-stars">${stars}</span> <span style="color:var(--gray-muted)">(${q.seller.reviews})</span> &nbsp;·&nbsp; Rate expires: ${q.rateExpiry}${q.guaranteed?' &nbsp;·&nbsp; <span class="chip chip-orange" style="font-size:10px;">Guaranteed</span>':''}</div>
    </div>
    <div class="quote-side">
      <div>
        <div class="quote-price">$${whole}<span class="decimals">.${dec}</span></div>
        <div class="quote-price-label">all-in estimate</div>
      </div>
      <form method="POST" action="/select-quote">${hiddenUiToken(session, 'select-quote')}<input type="hidden" name="quote_id" value="${q.id}"><button type="submit" class="ant-btn ant-btn-primary" style="width:100%;">Select</button></form>
    </div>
  </div>
</div></div>`;
  }).join('');

  const mainContent = `
<div class="results-main">
  <div class="summary-strip" style="margin-bottom:16px;">
    <div class="ss-item"><div class="ss-label">Origin</div><div class="ss-value">${sd.originCityLabel||sd.originCity||'-'}, ${sd.originCountry||'-'}</div></div>
    <div class="ss-item"><div class="ss-label">Destination</div><div class="ss-value">${sd.destCityLabel||sd.destCity||'-'}, ${sd.destCountry||'-'}</div></div>
    <div class="ss-item"><div class="ss-label">Load</div><div class="ss-value">${sd.containerQty||1} × ${sd.containerSize||'40'}' FCL</div></div>
    <div class="ss-item"><div class="ss-label">Goods</div><div class="ss-value">$${(sd.goodsValue||0).toLocaleString()}</div></div>
  </div>
  ${sortTabs}
  ${quoteCards}
  <div style="text-align:center;margin-top:16px;"><a href="/services" class="ant-btn">Back to Services</a></div>
</div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Results - FreightOS</title><style>${sharedCSS()}</style></head><body>${renderHeader(true)}${renderStepProgress(3)}<div class="results-layout">${sidebar}${mainContent}</div><footer class="site-footer">&copy; 2011-2026 FreightOS Ltd &nbsp;|&nbsp; MSA &nbsp;|&nbsp; Terms &nbsp;|&nbsp; Privacy</footer></body></html>`;
}

// ============================================================
// BOOKING (STEP 4)
// ============================================================
app.get('/booking', requireAuth, requireStep(4), (req, res) => res.send(renderBookingPage(req.session)));
app.post('/confirm', requireAuth, requireStep(4), requireUiToken('confirm'), (req, res) => {
  if (!req.body.terms) return res.redirect('/booking?error=terms');
  const shipId = 'S' + Date.now().toString().slice(-10);
  req.session.shipmentId = shipId;
  req.session.bookingConfirmed = true;
  req.session.step = Math.max(req.session.step, 5);
  accessLog.push({ path:'/confirm', method:'POST', time:new Date().toISOString(), shipmentId:shipId });
  res.redirect('/verification');
});

function renderBookingPage(session) {
  const q = QUOTES.find(q => q.id === session.selectedQuoteId);
  if (!q) return pageShell('Error','<div class="ant-alert ant-alert-error">No quote selected.</div>',true,4);
  const sv = session.servicesData || { insurance:true, customs:true, bondType:'single', goodsValue:0 };
  sv.goodsValue = session.searchData ? session.searchData.goodsValue : 0;
  const p = calcTotalPrice(q, sv);
  const sd = session.searchData || {};

  const body = `
<div class="ant-alert ant-alert-warning">
  <svg width="16" height="16" viewBox="0 0 16 16" fill="#faad14"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 7.5a.75.75 0 01-1.5 0v-3a.75.75 0 011.5 0v3z"/></svg>
  <span>You must complete your booking and pay within <strong>12 hours</strong> to confirm space at this rate.</span>
</div>
<div class="two-col">
  <div class="col-main">
    <div class="card" style="margin-bottom:16px;"><div class="card-body">
      <div class="card-title">Booking Summary</div>
      <h4 style="color:var(--primary-dark);margin-bottom:12px;font-size:14px;">Route</h4>
      <div class="booking-route">
        <div class="booking-route-step"><div class="icon">🏭</div><div class="label"><strong>${sd.originCityLabel||sd.originCity||'-'}</strong><br>${sd.originCountry||'-'}</div></div>
        <div class="booking-route-tail"></div>
        <div class="booking-route-step"><div class="icon">🚛</div><div class="label">Pickup</div></div>
        <div class="booking-route-tail"></div>
        <div class="booking-route-step"><div class="icon">⚓</div><div class="label"><strong>${q.originPort}</strong></div></div>
        <div class="booking-route-tail"></div>
        <div class="booking-route-step"><div class="icon">🚢</div><div class="label">Ocean<br>${q.p2pMin}-${q.p2pMax}d</div></div>
        <div class="booking-route-tail"></div>
        <div class="booking-route-step"><div class="icon">⚓</div><div class="label"><strong>${q.destPort}</strong></div></div>
        <div class="booking-route-tail"></div>
        <div class="booking-route-step"><div class="icon">🚛</div><div class="label">Delivery</div></div>
        <div class="booking-route-tail"></div>
        <div class="booking-route-step"><div class="icon">🏢</div><div class="label"><strong>${sd.destCityLabel||sd.destCity||'-'}</strong><br>${sd.destCountry||'-'}</div></div>
      </div>
      <hr>
      <table style="width:100%;font-size:14px;line-height:2;">
        <tr><td style="color:var(--gray-text);width:150px;">Quote ID</td><td><strong>${q.id}</strong></td></tr>
        <tr><td style="color:var(--gray-text);width:150px;">Mode</td><td>FCL · Door to Door</td></tr>
        <tr><td style="color:var(--gray-text);">Transit Time</td><td><strong>${q.transitMin}-${q.transitMax} days</strong> (port-to-port: ${q.p2pMin}-${q.p2pMax}d)</td></tr>
        <tr><td style="color:var(--gray-text);">Est. Departure</td><td>${q.estDeparture}</td></tr>
        <tr><td style="color:var(--gray-text);">Est. Arrival</td><td>${q.estArrival}</td></tr>
        <tr><td style="color:var(--gray-text);">Load</td><td>${sd.containerQty||1} × ${sd.containerSize||'40'}' Standard Container</td></tr>
        <tr><td style="color:var(--gray-text);">Goods</td><td>${sd.goodsDescription||'-'} · $${(sd.goodsValue||0).toLocaleString()}</td></tr>
      </table>
      <hr>
      <h4 style="color:var(--primary-dark);margin-bottom:8px;font-size:14px;">Service Providers</h4>
      <table style="width:100%;font-size:14px;line-height:2;">
        <tr><td style="color:var(--gray-text);width:150px;">Freight Seller</td><td><strong>${q.seller.name}</strong></td></tr>
        ${sv.customs?'<tr><td style="color:var(--gray-text);">Customs Broker</td><td>Clearit | USA</td></tr>':''}
        ${sv.insurance?'<tr><td style="color:var(--gray-text);">Insurance</td><td>FreightGuard Insurance</td></tr>':''}
      </table>
      <div style="margin-top:16px;padding:12px 16px;background:var(--teal-bg);border-radius:var(--radius);font-size:13px;color:#0d5875;">
        This rate is valid until ${q.rateExpiry}. If goods are gated in after this date, the rate may be subject to adjustment.
      </div>
    </div></div>

    <div class="card" style="margin-bottom:16px;"><div class="card-body">
      <div class="card-title">About ${q.seller.name}</div>
      <div style="display:flex;gap:16px;">
        <div style="font-size:40px;flex-shrink:0;">🚢</div>
        <div>
          <p style="font-style:italic;color:var(--gray-text);font-size:14px;margin-bottom:8px;">"Professional team with excellent communication. Shipment arrived on time and within budget."</p>
          <p style="font-size:13px;"><span class="quote-stars">★★★★★</span> — Verified Shipper</p>
          <p style="font-size:12px;color:var(--gray-muted);margin-top:4px;">Based on ${q.seller.reviews} reviews</p>
        </div>
      </div>
    </div></div>

    <div class="card"><div class="card-body">
      <form method="POST" action="/confirm">
        ${hiddenUiToken(session, 'confirm')}
        <div class="check-item"><input type="checkbox" class="ant-checkbox" id="terms" name="terms" value="on" required><label for="terms">I confirm this is a commercial shipment and all details are correct. I accept the <a href="#">MSA</a>, <a href="#">Terms</a>, and <a href="#">Privacy Policy</a>.</label></div>
        <div class="check-item"><input type="checkbox" class="ant-checkbox" id="goods_confirm" name="goods_confirm" value="on" required><label for="goods_confirm">I confirm the commodity is not on FreightOS's List of Excluded Goods.</label></div>
        <button type="submit" class="ant-btn ant-btn-primary ant-btn-lg ant-btn-block" style="margin-top:16px;">✓ &nbsp;Confirm &amp; Book Shipment</button>
      </form>
    </div></div>
  </div>

  <div class="col-side">
    <div class="card sidebar-card" style="position:sticky;top:100px;"><div class="card-body">
      <div class="card-title">Price Details</div>
      <table class="price-table">
        <tr><td>Seller's Quote</td><td>$${fmtPrice(p.freight)}</td></tr>
        ${sv.insurance?`<tr class="sub"><td>Transport Insurance</td><td>$${fmtPrice(p.insurance)}</td></tr>`:''}
        ${sv.customs?`<tr class="sub"><td>Customs Brokerage</td><td>$${fmtPrice(p.customs)}</td></tr>`:''}
        ${sv.customs?`<tr class="sub"><td>${sv.bondType==='annual'?'Annual':'Single Entry'} Bond</td><td>$${fmtPrice(p.bond)}</td></tr>`:''}
        <tr class="sub"><td>Platform Fee</td><td>$${fmtPrice(p.platformFee)}</td></tr>
        <tr class="muted"><td>Duties &amp; Taxes</td><td>Not Included</td></tr>
        <tr class="total-row"><td>Total</td><td>$${fmtPrice(p.total)}</td></tr>
      </table>
    </div></div>
  </div>
</div>`;
  return pageShell('Booking', body, true, 4);
}

// ============================================================
// VERIFICATION (STEP 5)
// ============================================================
app.get('/verification', requireAuth, requireStep(5), (req, res) => res.send(renderVerifPage(req.session)));
app.post('/verification', requireAuth, requireStep(5), requireUiToken('verification'), (req, res) => {
  const d = req.body;
  req.session.verificationData = {
    pickup: { company:d.pickup_company||'', contact:d.pickup_contact||'', email:d.pickup_email||'', phone:d.pickup_phone||'', address:d.pickup_address||'', city:d.pickup_city||'', state:d.pickup_state||'', country:d.pickup_country||'', zip:d.pickup_zip||'' },
    delivery: { company:d.delivery_company||'', contact:d.delivery_contact||'', email:d.delivery_email||'', phone:d.delivery_phone||'', address:d.delivery_address||'', city:d.delivery_city||'', state:d.delivery_state||'', country:d.delivery_country||'', zip:d.delivery_zip||'' }
  };
  req.session.completedAt = new Date().toISOString();
  accessLog.push({ path:'/verification', method:'POST', time:new Date().toISOString(), completed:true });
  res.redirect('/complete');
});

function renderVerifPage(session) {
  const shipId = session.shipmentId || 'N/A';
  const q = QUOTES.find(q => q.id === session.selectedQuoteId);
  const sd = session.searchData || {};
  const pct = session.verificationData ? 100 : 14;

  function addrForm(pfx, title, defCountry, defCityRaw) {
    const defCity = (defCityRaw||'').split(',')[0].trim();
    const countryOpts = COUNTRIES.replace(`value="${defCountry}"`, `value="${defCountry}" selected`);
    return `
<div class="card" style="margin-bottom:16px;"><div class="card-body">
  <div class="card-title">${title}</div>
  <div class="form-row">
    <div class="form-item"><label for="${pfx}_company">Company Name<span class="req">*</span></label><input class="ant-input" id="${pfx}_company" name="${pfx}_company" placeholder="Enter company name" required></div>
    <div class="form-item"><label for="${pfx}_contact">Full Name<span class="req">*</span></label><input class="ant-input" id="${pfx}_contact" name="${pfx}_contact" placeholder="Enter first & last name" required></div>
  </div>
  <div class="form-row">
    <div class="form-item"><label for="${pfx}_email">Email<span class="req">*</span></label><input class="ant-input" type="email" id="${pfx}_email" name="${pfx}_email" placeholder="Enter email address" required></div>
    <div class="form-item"><label for="${pfx}_phone">Phone<span class="req">*</span></label><input class="ant-input" type="tel" id="${pfx}_phone" name="${pfx}_phone" placeholder="Enter phone number" required></div>
  </div>
  <div class="form-item"><label for="${pfx}_address">Street Address<span class="req">*</span></label><input class="ant-input" id="${pfx}_address" name="${pfx}_address" placeholder="Street, Number, Building, Floor" required></div>
  <div class="form-row-3">
    <div class="form-item"><label for="${pfx}_city">City</label><input class="ant-input" id="${pfx}_city" name="${pfx}_city" value="${defCity||''}" placeholder="Enter city"></div>
    <div class="form-item"><label for="${pfx}_state">State / Province</label><input class="ant-input" id="${pfx}_state" name="${pfx}_state" placeholder="Enter state"></div>
    <div class="form-item"><label for="${pfx}_country">Country</label><select class="ant-select" id="${pfx}_country" name="${pfx}_country">${countryOpts}</select></div>
  </div>
  <div class="form-item" style="max-width:180px;"><label for="${pfx}_zip">ZIP / Postal Code</label><input class="ant-input" id="${pfx}_zip" name="${pfx}_zip" placeholder="Enter ZIP"></div>
</div></div>`;
  }

  const sideItems = [
    { label:'Pickup — Consignor', done:false },
    { label:'Delivery — Consignee', done:false },
  ];
  const sideHtml = sideItems.map(it => `
    <div class="sidebar-menu-item${it.done?' done':''}">
      <div class="menu-icon${it.done?' done':''}">${it.done?'✓':''}</div>
      <span>${it.label}</span>
    </div>`).join('');

  const page = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verification - FreightOS</title><style>${sharedCSS()}</style></head><body>
${renderHeader(true)}
${renderStepProgress(5)}
<div class="verif-header">
  <div style="flex:1;">
    <div style="display:flex;align-items:center;gap:12px;">
      <h2>Shipment #${shipId}</h2>
      <span class="chip chip-primary">Booking Placed</span>
    </div>
    <div style="font-size:13px;color:var(--gray-text);margin-top:4px;">Fulfilled by <strong>${q?q.seller.name:'-'}</strong></div>
    <div class="verif-progress"><div class="verif-progress-bar" style="width:${pct}%;"></div></div>
  </div>
</div>
<div class="verif-layout">
  <div class="verif-sidebar">
    <div style="padding:16px;background:var(--teal-bg);border-radius:var(--radius-lg);margin-bottom:20px;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">🚢</div>
      <div style="font-size:14px;font-weight:500;color:#0d5875;">Almost ready to go!</div>
      <div style="font-size:12px;color:var(--gray-text);margin-top:4px;">Fill in the details below so your shipment can be processed.</div>
    </div>
    <div style="font-size:12px;color:var(--gray-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Required Items</div>
    ${sideHtml}
    <hr style="margin:16px 0;">
    <div style="font-size:12px;color:var(--gray-text);">
      <strong>Route</strong><br>
      ${sd.originCityLabel||sd.originCity||'-'} → ${sd.destCityLabel||sd.destCity||'-'}<br>
      Door to Door
    </div>
  </div>
  <div class="verif-main">
    <div class="ant-alert ant-alert-warning" style="margin-bottom:20px;">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="#faad14"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 7.5a.75.75 0 01-1.5 0v-3a.75.75 0 011.5 0v3z"/></svg>
      <span>Complete all shipping details so the logistics provider can process your shipment.</span>
    </div>
    <form method="POST" action="/verification">
      ${hiddenUiToken(session, 'verification')}
      ${addrForm('pickup', 'Pickup — Consignor (Shipper)', sd.originCountry, sd.originCityLabel||sd.originCity)}
      ${addrForm('delivery', 'Delivery — Consignee (Receiver)', sd.destCountry, sd.destCityLabel||sd.destCity)}
      <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:8px;">
        <button type="submit" class="ant-btn ant-btn-primary ant-btn-lg">Submit Shipping Details</button>
      </div>
    </form>
  </div>
</div>
<footer class="site-footer">&copy; 2011-2026 FreightOS Ltd</footer></body></html>`;
  return page;
}

// ============================================================
// COMPLETION
// ============================================================
app.get('/complete', requireAuth, (req, res) => {
  if (!req.session.bookingConfirmed) return res.redirect('/search');
  const q = QUOTES.find(q => q.id === req.session.selectedQuoteId);
  const sv = req.session.servicesData || { insurance:true,customs:true,bondType:'single',goodsValue:0 };
  sv.goodsValue = req.session.searchData ? req.session.searchData.goodsValue : 0;
  const p = q ? calcTotalPrice(q, sv) : { total:0 };
  const body = `
<div class="card"><div class="card-body completion">
  <div class="icon">✅</div>
  <h2>Booking Complete!</h2>
  <p>Your shipment <strong>#${req.session.shipmentId}</strong> has been confirmed.</p>
  <div style="text-align:left;max-width:480px;margin:0 auto;">
    <table style="width:100%;font-size:14px;line-height:2.2;">
      <tr><td style="color:var(--gray-text);">Shipment ID</td><td><strong>${req.session.shipmentId}</strong></td></tr>
      <tr><td style="color:var(--gray-text);">Quote ID</td><td><strong>${q?q.id:'-'}</strong></td></tr>
      <tr><td style="color:var(--gray-text);">Seller</td><td>${q?q.seller.name:'-'}</td></tr>
      <tr><td style="color:var(--gray-text);">Route</td><td>${q?q.originPort+' → '+q.destPort:'-'}</td></tr>
      <tr><td style="color:var(--gray-text);">Transit</td><td>${q?q.transitMin+'-'+q.transitMax+' days':'-'}</td></tr>
      <tr><td style="color:var(--gray-text);">Est. Arrival</td><td>${q?q.estArrival:'-'}</td></tr>
      <tr><td style="color:var(--gray-text);">Total</td><td><strong style="color:var(--primary-dark);font-size:18px;">$${fmtPrice(p.total)}</strong></td></tr>
    </table>
  </div>
  <div style="margin-top:24px;"><a href="/shipments" class="ant-btn ant-btn-primary">View My Shipments</a></div>
</div></div>`;
  res.send(pageShell('Booking Complete', body, true, 5));
});

// ============================================================
// SHIPMENTS
// ============================================================
app.get('/shipments', requireAuth, (req, res) => {
  const has = req.session.bookingConfirmed && req.session.shipmentId;
  const q = has ? QUOTES.find(q => q.id === req.session.selectedQuoteId) : null;
  let rows = '';
  if (has && q) {
    rows = `<tr><td style="padding:12px 16px;"><a href="/complete">${req.session.shipmentId}</a></td><td style="padding:12px 16px;">${q.originPort} → ${q.destPort}</td><td style="padding:12px 16px;"><span class="chip chip-primary">Booking Placed</span></td><td style="padding:12px 16px;">${q.seller.name}</td></tr>`;
  } else {
    rows = '<tr><td colspan="4" style="text-align:center;color:var(--gray-muted);padding:32px;">No shipments yet. <a href="/search">Book your first shipment</a>.</td></tr>';
  }
  const body = `<h2 style="margin-bottom:16px;">My Shipments</h2><div class="card" style="padding:0;overflow:hidden;"><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="background:var(--bg);border-bottom:1px solid var(--border);"><th style="padding:12px 16px;text-align:left;">ID</th><th style="padding:12px 16px;text-align:left;">Route</th><th style="padding:12px 16px;text-align:left;">Status</th><th style="padding:12px 16px;text-align:left;">Seller</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  res.send(pageShell('Shipments', body, true, null));
});

// ============================================================
// ROUTE PLANNER — Multi-Leg Optimization
// ============================================================
const DOMESTIC_CN = [
  { id:'D1', from:'Dongguan', to:'Shenzhen (Yantian Port)', port:'shenzhen', days:1, cost:180 },
  { id:'D2', from:'Dongguan', to:'Guangzhou (Nansha Port)', port:'guangzhou', days:1, cost:220 },
  { id:'D3', from:'Dongguan', to:'Ningbo (Beilun Port)', port:'ningbo', days:3, cost:480 },
  { id:'D4', from:'Dongguan', to:'Shanghai (Yangshan Port)', port:'shanghai', days:3, cost:650 },
];
const OCEAN_LEGS = [
  { id:'O1', fromPort:'shenzhen', toPort:'losangeles', fromLabel:'Shenzhen', toLabel:'Los Angeles', maxDays:24, cost:4800, carrier:'COSCO Shipping', rating:4.3, reviews:890 },
  { id:'O2', fromPort:'shenzhen', toPort:'losangeles', fromLabel:'Shenzhen', toLabel:'Los Angeles', maxDays:21, cost:5300, carrier:'Maersk Line', rating:4.6, reviews:2450 },
  { id:'O3', fromPort:'shenzhen', toPort:'longbeach', fromLabel:'Shenzhen', toLabel:'Long Beach', maxDays:26, cost:4500, carrier:'Yang Ming Marine', rating:4.1, reviews:340 },
  { id:'O4', fromPort:'guangzhou', toPort:'losangeles', fromLabel:'Guangzhou', toLabel:'Los Angeles', maxDays:27, cost:4600, carrier:'MSC', rating:4.3, reviews:1650 },
  { id:'O5', fromPort:'ningbo', toPort:'losangeles', fromLabel:'Ningbo', toLabel:'Los Angeles', maxDays:23, cost:5000, carrier:'Seabay International', rating:4.7, reviews:1880 },
  { id:'O6', fromPort:'ningbo', toPort:'longbeach', fromLabel:'Ningbo', toLabel:'Long Beach', maxDays:25, cost:4650, carrier:'ONE (Ocean Network)', rating:4.4, reviews:780 },
  { id:'O7', fromPort:'shanghai', toPort:'losangeles', fromLabel:'Shanghai', toLabel:'Los Angeles', maxDays:20, cost:5500, carrier:'Maersk Line', rating:4.6, reviews:2450 },
  { id:'O8', fromPort:'shanghai', toPort:'losangeles', fromLabel:'Shanghai', toLabel:'Los Angeles', maxDays:24, cost:4850, carrier:'COSCO Shipping', rating:4.3, reviews:890 },
];
const US_DELIVERY = [
  { id:'L1', from:'Los Angeles', fromPort:'losangeles', to:'Dallas, TX', days:3, cost:850 },
  { id:'L2', from:'Long Beach', fromPort:'longbeach', to:'Dallas, TX', days:3, cost:820 },
];
const ROUTE_SERVICES = { insuranceRate:0.0042, customs:275, bond:65, platformRate:0.015 };

app.get('/route-planner', requireAuth, (req, res) => {
  const goodsValue = 35000;
  const svcFixed = ROUTE_SERVICES.customs + ROUTE_SERVICES.bond + Math.round(goodsValue * ROUTE_SERVICES.insuranceRate * 100)/100;

  const domRows = DOMESTIC_CN.map(d => `<tr><td>${d.id}</td><td>${d.from}</td><td>${d.to}</td><td>${d.days} day${d.days>1?'s':''}</td><td>$${d.cost}</td></tr>`).join('');
  const oceanRows = OCEAN_LEGS.map(o => {
    const stars = '★'.repeat(Math.floor(o.rating)) + (o.rating%1>=0.5?'☆':'');
    return `<tr><td>${o.id}</td><td>${o.fromLabel}</td><td>${o.toLabel}</td><td>${o.maxDays} days</td><td>$${fmtPrice(o.cost)}</td><td>${o.carrier}</td><td><span class="quote-stars">${stars}</span> ${o.rating} <span style="color:var(--gray-muted)">(${o.reviews})</span></td></tr>`;
  }).join('');
  const usRows = US_DELIVERY.map(l => `<tr><td>${l.id}</td><td>${l.from}</td><td>${l.to}</td><td>${l.days} days</td><td>$${l.cost}</td></tr>`).join('');

  const body = `
<h2 style="margin-bottom:4px;">Route Planner</h2>
<p style="color:var(--gray-text);margin-bottom:20px;">Plan your multi-leg shipment by comparing domestic trucking, ocean freight, and last-mile delivery options.</p>

<div class="ant-alert ant-alert-info" style="margin-bottom:20px;">
  <svg width="16" height="16" viewBox="0 0 16 16" fill="#1890ff"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 018 4zm0 8a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
  <span>Total transit = Domestic CN days + Ocean days + US Delivery days. Service costs (insurance, customs, bond, platform fee) are added to all routes. Only routes where <strong>domestic origin port matches ocean origin</strong> and <strong>ocean destination matches US delivery origin</strong> are valid.</span>
</div>

<div class="card" style="margin-bottom:16px;"><div class="card-body">
  <div class="card-title" style="display:flex;align-items:center;gap:8px;">
    <span style="font-size:20px;">🚛</span> Leg 1 — Domestic China Trucking (Factory → Port)
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead><tr style="background:var(--bg);border-bottom:2px solid var(--border-mid);">
      <th style="padding:10px 12px;text-align:left;width:50px;">ID</th>
      <th style="padding:10px 12px;text-align:left;">Origin</th>
      <th style="padding:10px 12px;text-align:left;">Destination (Port)</th>
      <th style="padding:10px 12px;text-align:left;">Transit</th>
      <th style="padding:10px 12px;text-align:left;">Cost</th>
    </tr></thead>
    <tbody>${domRows}</tbody>
  </table>
</div></div>

<div class="card" style="margin-bottom:16px;"><div class="card-body">
  <div class="card-title" style="display:flex;align-items:center;gap:8px;">
    <span style="font-size:20px;">🚢</span> Leg 2 — Ocean Freight (Port → Port)
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead><tr style="background:var(--bg);border-bottom:2px solid var(--border-mid);">
      <th style="padding:10px 12px;text-align:left;width:50px;">ID</th>
      <th style="padding:10px 12px;text-align:left;">Origin Port</th>
      <th style="padding:10px 12px;text-align:left;">Dest Port</th>
      <th style="padding:10px 12px;text-align:left;">Max Transit</th>
      <th style="padding:10px 12px;text-align:left;">Cost</th>
      <th style="padding:10px 12px;text-align:left;">Carrier</th>
      <th style="padding:10px 12px;text-align:left;">Rating</th>
    </tr></thead>
    <tbody>${oceanRows}</tbody>
  </table>
</div></div>

<div class="card" style="margin-bottom:16px;"><div class="card-body">
  <div class="card-title" style="display:flex;align-items:center;gap:8px;">
    <span style="font-size:20px;">🚛</span> Leg 3 — US Domestic Delivery (Port → Warehouse)
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead><tr style="background:var(--bg);border-bottom:2px solid var(--border-mid);">
      <th style="padding:10px 12px;text-align:left;width:50px;">ID</th>
      <th style="padding:10px 12px;text-align:left;">Origin</th>
      <th style="padding:10px 12px;text-align:left;">Destination</th>
      <th style="padding:10px 12px;text-align:left;">Transit</th>
      <th style="padding:10px 12px;text-align:left;">Cost</th>
    </tr></thead>
    <tbody>${usRows}</tbody>
  </table>
</div></div>

<div class="card"><div class="card-body">
  <div class="card-title" style="display:flex;align-items:center;gap:8px;">
    <span style="font-size:20px;">📋</span> Service Costs (applied to all routes)
  </div>
  <table style="width:100%;font-size:14px;max-width:400px;">
    <tr><td style="padding:6px 0;color:var(--gray-text);">Transport Insurance (0.42% of $${goodsValue.toLocaleString()})</td><td style="padding:6px 0;text-align:right;font-weight:500;">$${fmtPrice(Math.round(goodsValue * ROUTE_SERVICES.insuranceRate * 100)/100)}</td></tr>
    <tr><td style="padding:6px 0;color:var(--gray-text);">Customs Brokerage</td><td style="padding:6px 0;text-align:right;font-weight:500;">$${fmtPrice(ROUTE_SERVICES.customs)}</td></tr>
    <tr><td style="padding:6px 0;color:var(--gray-text);">Single Entry Bond</td><td style="padding:6px 0;text-align:right;font-weight:500;">$${fmtPrice(ROUTE_SERVICES.bond)}</td></tr>
    <tr><td style="padding:6px 0;color:var(--gray-text);">Platform Fee</td><td style="padding:6px 0;text-align:right;font-weight:500;">1.5% of ocean freight</td></tr>
    <tr style="border-top:1px solid var(--border);"><td style="padding:8px 0;font-weight:600;">Fixed total (excl. platform fee)</td><td style="padding:8px 0;text-align:right;font-weight:700;">$${fmtPrice(svcFixed)}</td></tr>
  </table>
</div></div>`;
  res.send(pageShell('Route Planner', body, true, null));
});

app.get('/api/route-planner', requireVerifierToken, (req, res) => {
  res.json({
    domestic_cn: DOMESTIC_CN,
    ocean: OCEAN_LEGS.map(o => ({ id:o.id, fromPort:o.fromPort, toPort:o.toPort, fromLabel:o.fromLabel, toLabel:o.toLabel, maxDays:o.maxDays, cost:o.cost, carrier:o.carrier, rating:o.rating, reviews:o.reviews })),
    us_delivery: US_DELIVERY,
    services: ROUTE_SERVICES
  });
});

// ============================================================
// API
// ============================================================
app.get('/api/access-log', requireVerifierToken, (req, res) => res.json(accessLog));
app.get('/api/booking-state', requireVerifierToken, (req, res) => {
  const s = sessionStore[VALID_SESSION];
  if (!s) return res.json({ authenticated:false });
  const q = s.selectedQuoteId ? QUOTES.find(q => q.id === s.selectedQuoteId) : null;
  const sv = s.servicesData || {};
  sv.goodsValue = s.searchData ? s.searchData.goodsValue : 0;
  const p = q ? calcTotalPrice(q, sv) : null;
  res.json({ authenticated:true, step:s.step, searchData:s.searchData, servicesData:s.servicesData, selectedQuoteId:s.selectedQuoteId, selectedQuote:q?{id:q.id,seller:q.seller.name,basePrice:q.basePrice,transitMin:q.transitMin,transitMax:q.transitMax,estArrival:q.estArrival,originPort:q.originPort,destPort:q.destPort}:null, pricing:p, bookingConfirmed:s.bookingConfirmed, shipmentId:s.shipmentId, verificationData:s.verificationData, completedAt:s.completedAt, routePlannerAccessed: (accessLog||[]).some(e=>e.path==='/route-planner') });
});
app.get('/api/quotes', requireVerifierToken, (req, res) => {
  const s = sessionStore[VALID_SESSION] || {};
  const sv = s.servicesData || { insurance:true,customs:true,bondType:'single',goodsValue:0 };
  sv.goodsValue = s.searchData ? s.searchData.goodsValue : 0;
  const sd = s.searchData || {};
  const filtered = filterQuotes(sd);
  res.json(filtered.map(q => ({ id:q.id, seller:q.seller.name, originPort:q.originPort, destPort:q.destPort, transitMin:q.transitMin, transitMax:q.transitMax, estDeparture:q.estDeparture, estArrival:q.estArrival, basePrice:q.basePrice, totalPrice:calcTotalPrice(q,sv).total, badges:q.badges, guaranteed:q.guaranteed })));
});

app.listen(PORT, () => {
  console.log(`FreightOS mock booking platform running at http://localhost:${PORT}`);
  console.log(`Login: ${VALID_EMAIL} / ${VALID_PASSWORD}`);
});
