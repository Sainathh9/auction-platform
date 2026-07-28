const now = Date.now();

function futureMs(minutes) {
  return now + minutes * 60 * 1000;
}

function pastMs(minutes) {
  return now - minutes * 60 * 1000;
}

export const MOCK_AUCTIONS = [
  {
    id: 'AUC-7f3a01',
    title: 'Vintage Rolex Submariner 1968',
    category: 'Jewelry',
    image: '/images/rolex.png',
    startPrice: 8500,
    currentHighestBid: 14250,
    bidCount: 23,
    status: 'ACTIVE',
    startTime: pastMs(45),
    endTime: futureMs(12),
    description: 'Original 1968 Rolex Submariner ref. 5513, meters-first dial, matching serial case and bracelet. Full service history from RSC Geneva.',
  },
  {
    id: 'AUC-b82e44',
    title: '2019 Porsche 911 GT3 RS',
    category: 'Vehicles',
    image: '/images/porsche.png',
    startPrice: 145000,
    currentHighestBid: 187500,
    bidCount: 41,
    status: 'ACTIVE',
    startTime: pastMs(120),
    endTime: futureMs(3),
    description: 'Weissach package, PTS Chalk exterior, 7,200 miles, full ceramic coating. Clean Carfax, single owner.',
  },
  {
    id: 'AUC-d19c78',
    title: 'Basquiat "Untitled" Lithograph',
    category: 'Art',
    image: '/images/basquiat.png',
    startPrice: 12000,
    currentHighestBid: 34800,
    bidCount: 67,
    status: 'ACTIVE',
    startTime: pastMs(180),
    endTime: futureMs(0.5),
    description: 'Limited edition lithograph #42/150. Certificate of authenticity from the Estate. Museum-quality framing included.',
  },
  {
    id: 'AUC-a4f912',
    title: 'Apple-1 Computer (1976)',
    category: 'Electronics',
    image: '/images/apple1.png',
    startPrice: 250000,
    currentHighestBid: 412000,
    bidCount: 15,
    status: 'ACTIVE',
    startTime: pastMs(300),
    endTime: futureMs(45),
    description: 'Verified original Apple-1 with byte shop Koa wood case. NTI board #82. Operational — boots to BASIC prompt.',
  },
  {
    id: 'AUC-ee5501',
    title: '1952 Topps Mickey Mantle #311',
    category: 'Collectibles',
    image: '/images/rolex.png',
    startPrice: 50000,
    currentHighestBid: 78900,
    bidCount: 34,
    status: 'ACTIVE',
    startTime: pastMs(60),
    endTime: futureMs(90),
    description: 'PSA 6 EX-MT. Clean surfaces, strong centering for the issue. One of the most iconic post-war baseball cards.',
  },
  {
    id: 'AUC-c33b09',
    title: 'Manhattan Penthouse Unit 42F',
    category: 'Real Estate',
    image: '/images/porsche.png',
    startPrice: 2800000,
    currentHighestBid: 3150000,
    bidCount: 8,
    status: 'ACTIVE',
    startTime: pastMs(1440),
    endTime: futureMs(180),
    description: '3BR/3BA, 2,800 sqft. Floor-to-ceiling windows, Central Park views. Full-service building with concierge.',
  },
  {
    id: 'AUC-7719fa',
    title: 'Leica M6 TTL 0.85 Black Chrome',
    category: 'Electronics',
    image: '/images/leica.png',
    startPrice: 3200,
    currentHighestBid: 5100,
    bidCount: 19,
    status: 'ACTIVE',
    startTime: pastMs(30),
    endTime: futureMs(8),
    description: 'Mint- condition with original box and papers. Meter tested accurate ±0.3 stop. Recently CLA\'d by DAG.',
  },
  {
    id: 'AUC-f10d82',
    title: 'Hermès Birkin 25 Gold Togo',
    category: 'Jewelry',
    image: '/images/hermes.png',
    startPrice: 15000,
    currentHighestBid: 22400,
    bidCount: 52,
    status: 'FINISHED',
    startTime: pastMs(600),
    endTime: pastMs(10),
    description: 'Gold Togo leather with gold hardware. Stamp Y (2020). Includes dust bag, box, rain cover, clochette, lock and keys.',
  },
  {
    id: 'AUC-889b3e',
    title: 'Sealed Pokemon Base Set Booster Box',
    category: 'Collectibles',
    image: '/images/basquiat.png',
    startPrice: 20000,
    currentHighestBid: 38750,
    bidCount: 89,
    status: 'FINISHED',
    startTime: pastMs(2880),
    endTime: pastMs(60),
    description: 'WOTC 1999 Unlimited Base Set. Factory sealed with intact shrink wrap. Green wing Charizard art.',
  },
  {
    id: 'AUC-44ae17',
    title: 'Patek Philippe Nautilus 5711/1A',
    category: 'Jewelry',
    image: '/images/rolex.png',
    startPrice: 85000,
    currentHighestBid: 142000,
    bidCount: 31,
    status: 'ACTIVE',
    startTime: pastMs(90),
    endTime: futureMs(25),
    description: 'Blue dial, stainless steel. Full set with box and papers dated 2021. Unworn condition, stickers intact.',
  },
];

export function getMockBidHistory(auctionId) {
  const auction = MOCK_AUCTIONS.find((a) => a.id === auctionId);
  if (!auction) return [];

  const bids = [];
  const bidderPool = ['USR-a1b2', 'USR-c3d4', 'USR-e5f6', 'USR-g7h8', 'USR-i9j0', 'USR-k1l2', 'USR-m3n4'];
  let price = auction.startPrice;
  const step = (auction.currentHighestBid - auction.startPrice) / Math.max(auction.bidCount, 1);

  for (let i = 0; i < Math.min(auction.bidCount, 30); i++) {
    price += step * (0.6 + Math.random() * 0.8);
    price = Math.round(Math.min(price, auction.currentHighestBid) * 100) / 100;
    bids.push({
      id: `BID-${auctionId}-${i}`,
      userId: bidderPool[i % bidderPool.length],
      amount: price,
      timestamp: auction.startTime + ((auction.endTime - auction.startTime) * i) / auction.bidCount,
      status: 'ACCEPTED',
    });
  }

  return bids.reverse(); // newest first
}

export const MOCK_USER_ID = 'USR-a1b2';

export function getMockUserBids() {
  return [
    { auctionId: 'AUC-7f3a01', auctionTitle: 'Vintage Rolex Submariner 1968', amount: 13800, status: 'OUTBID', timestamp: pastMs(20) },
    { auctionId: 'AUC-b82e44', auctionTitle: '2019 Porsche 911 GT3 RS', amount: 187500, status: 'WINNING', timestamp: pastMs(5) },
    { auctionId: 'AUC-d19c78', auctionTitle: 'Basquiat "Untitled" Lithograph', amount: 34800, status: 'WINNING', timestamp: pastMs(2) },
    { auctionId: 'AUC-a4f912', auctionTitle: 'Apple-1 Computer (1976)', amount: 390000, status: 'OUTBID', timestamp: pastMs(60) },
    { auctionId: 'AUC-f10d82', auctionTitle: 'Hermès Birkin 25 Gold Togo', amount: 21000, status: 'LOST', timestamp: pastMs(300) },
    { auctionId: 'AUC-889b3e', auctionTitle: 'Sealed Pokemon Base Set Booster Box', amount: 38750, status: 'WINNING', timestamp: pastMs(100) },
    { auctionId: 'AUC-44ae17', auctionTitle: 'Patek Philippe Nautilus 5711/1A', amount: 128000, status: 'OUTBID', timestamp: pastMs(40) },
  ];
}
