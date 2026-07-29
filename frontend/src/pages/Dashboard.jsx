import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAllAuctions, getTopSellers, getCategories } from '../lib/api';
import DataTable from '../components/DataTable';
import AuctionCard from '../components/AuctionCard';
import Badge from '../components/Badge';
import CountdownTimer from '../components/CountdownTimer';
import PlaceholderImage from '../components/PlaceholderImage';

function formatCurrency(val) {
  if (val == null) return '—';
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

function getStatusVariant(auction) {
  if (auction.status === 'FINISHED') return 'ended';
  const remaining = auction.endTime - Date.now();
  if (remaining <= 60000) return 'closing-soon';
  return 'ongoing';
}

const SORT_OPTIONS = [
  { value: 'endTime-asc', label: 'Ending Soon' },
  { value: 'currentHighestBid-desc', label: 'Highest Value' },
  { value: 'bidCount-desc', label: 'Most Bids' },
  { value: 'title-asc', label: 'Name A–Z' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('cat') || '');
  const [sortOption, setSortOption] = useState('endTime-asc');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [auctionsList, setAuctionsList] = useState([]);
  const [topSellers, setTopSellers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch live auctions from backend API on mount
  useEffect(() => {
    setLoading(true);
    Promise.all([
      getAllAuctions(),
      getTopSellers(),
      getCategories()
    ]).then(([auctions, sellers, cats]) => {
      if (Array.isArray(auctions)) setAuctionsList(auctions);
      if (Array.isArray(sellers)) setTopSellers(sellers);
      if (Array.isArray(cats)) setCategories(cats);
    }).catch((err) => {
      console.error('Failed to load data from backend API', err);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  // Sync search params from URL
  useEffect(() => {
    const q = searchParams.get('q');
    const cat = searchParams.get('cat');
    if (q !== null) setSearchQuery(q);
    if (cat !== null) setCategoryFilter(cat);
  }, [searchParams]);

  // Featured Auctions list for Hero Section
  const featuredAuctions = useMemo(() => {
    return auctionsList.slice(0, 4);
  }, [auctionsList]);

  const currentHeroAuction = featuredAuctions[activeHeroIndex] || featuredAuctions[0];

  const filteredData = useMemo(() => {
    let result = [...auctionsList];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          (a.description && a.description.toLowerCase().includes(q))
      );
    }
    if (categoryFilter) {
      result = result.filter((a) => a.category === categoryFilter);
    }
    if (statusFilter) {
      result = result.filter((a) => a.status === statusFilter);
    }

    const [key, dir] = sortOption.split('-');
    result.sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return dir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [auctionsList, searchQuery, categoryFilter, sortOption, statusFilter]);

  const columns = [
    {
      key: 'title',
      label: 'Item',
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 flex-shrink-0 overflow-hidden border border-gray-200 rounded">
            <PlaceholderImage src={row.images?.[0]} name={val} size={40} className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="font-semibold text-gray-900">{val}</div>
            <div className="text-xs text-gray-500">{row.category}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'id',
      label: 'ID',
      sortable: false,
      render: (val) => <span className="text-gray-500 text-xs">{val}</span>,
    },
    {
      key: 'currentHighestBid',
      label: 'Current Bid',
      sortable: true,
      align: 'right',
      render: (val) => <span className="font-bold text-gray-900">{formatCurrency(val)}</span>,
    },
    {
      key: 'bidCount',
      label: 'Bids',
      sortable: true,
      align: 'right',
    },
    {
      key: 'endTime',
      label: 'Time Left / Ends At',
      sortable: true,
      render: (val, row) =>
        row.status === 'FINISHED' ? (
          <div>
            <span className="text-xs text-gray-500">Ended</span>
            <div className="text-[11px] text-gray-400 font-medium">{val ? new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
          </div>
        ) : (
          <div>
            <CountdownTimer expiresAt={val} compact />
            <div className="text-[11px] text-gray-500 font-medium mt-0.5">{val ? new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
          </div>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: false,
      render: (_val, row) => <Badge variant={getStatusVariant(row)} />,
    },
  ];

  return (
    <div className="bg-[#F8F9FA] min-h-screen">
      {/* Featured Auctions Hero Section */}
      {!searchQuery && !categoryFilter && currentHeroAuction && (
        <section className="bg-gray-900 text-white py-14 px-6 border-b border-gray-800">
          <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Content */}
            <div className="lg:col-span-6 space-y-6">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-200 bg-white/10 backdrop-blur-xs border border-white/20 px-3 py-1 uppercase tracking-wider rounded">
                  FEATURED LIVE AUCTION
                </span>
                <span className="text-gray-400 text-xs">{currentHeroAuction.id}</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-serif font-bold text-white tracking-tight leading-tight">
                {currentHeroAuction.title}
              </h1>

              <p className="text-gray-300 text-sm leading-relaxed line-clamp-3">
                {currentHeroAuction.description}
              </p>

              <div className="grid grid-cols-2 gap-6 py-5 border-y border-gray-800">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Current Highest Bid</div>
                  <div className="text-3xl font-extrabold text-white mt-1">
                    {formatCurrency(currentHeroAuction.currentHighestBid)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Time Remaining</div>
                  <div className="text-2xl mt-1">
                    <CountdownTimer expiresAt={currentHeroAuction.endTime} darkBg />
                  </div>
                  {currentHeroAuction.startTime && (
                    <div className="text-xs text-gray-400 font-medium mt-1">
                      Started: {new Date(currentHeroAuction.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  {currentHeroAuction.endTime && (
                    <div className="text-xs text-gray-400 font-medium mt-0.5">
                      Ends: {new Date(currentHeroAuction.endTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 pt-2">
                <button
                  onClick={() => navigate(`/auction/${currentHeroAuction.id}`)}
                  className="bg-white text-gray-900 hover:bg-gray-100 font-bold px-8 py-3.5 text-xs uppercase tracking-wider transition-all cursor-pointer rounded-full shadow-lg hover:shadow-xl"
                >
                  Explore Lot & Place Bid →
                </button>
                <div className="flex items-center gap-2">
                  {featuredAuctions.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveHeroIndex(idx)}
                      className={`w-3 h-3 rounded-full transition-all cursor-pointer ${
                        activeHeroIndex === idx ? 'bg-white w-6' : 'bg-gray-700 hover:bg-gray-500'
                      }`}
                      title={`Featured Lot ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Right Large Photo Card */}
            <div className="lg:col-span-6 relative aspect-16/10 bg-gray-800 overflow-hidden rounded-2xl border border-gray-700 shadow-2xl group cursor-pointer"
                 onClick={() => navigate(`/auction/${currentHeroAuction.id}`)}>
              <PlaceholderImage
                src={currentHeroAuction.images?.[0]}
                name={currentHeroAuction.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute top-4 right-4 bg-gray-900/90 text-white text-xs px-3.5 py-1.5 rounded-full border border-gray-700 font-medium">
                {currentHeroAuction.bidCount} Bids Placed
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Content Area */}
      <div className="max-w-[1400px] mx-auto px-6 py-10 space-y-10">
        {/* Categories Bar */}
        <section className="bg-white border border-gray-200 p-5 rounded-xl shadow-xs space-y-3">
          <div className="text-xs font-bold text-gray-900 uppercase tracking-wider">
            Explore Auction Categories
          </div>
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 text-xs">
            <button
              onClick={() => setCategoryFilter('')}
              className={`px-4 py-2 font-semibold rounded-full transition-colors cursor-pointer border ${
                categoryFilter === ''
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              All Categories ({auctionsList.length})
            </button>
            {categories.map((cat) => {
              const count = auctionsList.filter((a) => a.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                  className={`px-4 py-2 font-semibold rounded-full transition-colors cursor-pointer border whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        </section>

        {/* Top Rated Sellers Section (Spacious Luxury Cards) */}
        {!searchQuery && !categoryFilter && (
          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Top Rated Verified Sellers</h2>
                <p className="text-xs text-gray-500 mt-1">Authentic luxury estates & certified auction houses</p>
              </div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">VERIFIED ESCROW GUARANTEE</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {topSellers.map((seller) => (
                <div
                  key={seller.id}
                  className="bg-white border border-gray-200 p-6 rounded-xl shadow-xs hover:shadow-md hover:border-gray-900 transition-all duration-200 flex flex-col justify-between group cursor-pointer"
                  onClick={() => navigate(`/?q=${encodeURIComponent(seller.name.split(' ')[0])}`)}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-gray-100 rounded-full overflow-hidden border border-gray-200 flex-shrink-0 group-hover:scale-105 transition-transform">
                      <PlaceholderImage src={seller.image} name={seller.name} size={64} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <h4 className="font-bold text-base text-gray-900 group-hover:text-black leading-snug">{seller.name}</h4>
                      <div className="text-xs text-gray-500 mt-1">{seller.sales} Available</div>
                      <div className="text-xs font-bold text-gray-900 mt-1.5 flex items-center gap-1">
                        <span className="text-amber-500"></span>
                        <span>{seller.rating} Seller Score</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 group-hover:text-gray-900 transition-colors font-medium">
                    <span>{seller.verified}</span>
                    <span>Explore →</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Auction Items Control & Search Bar */}
        <section className="space-y-5">
          <div className="bg-white border border-gray-200 p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
            {/* Search Input */}
            <div className="relative min-w-[280px] flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search lot title, ID, category..."
                className="w-full bg-gray-50 border border-gray-200 rounded-full text-gray-900 text-sm px-5 py-2.5 pr-8 focus:outline-none focus:border-gray-900 focus:bg-white placeholder:text-gray-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 text-xs cursor-pointer"
                >
                  
                </button>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="border border-gray-200 bg-white rounded-lg text-gray-900 text-xs px-3.5 py-2.5 focus:outline-none focus:border-gray-900 font-medium"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-200 bg-white rounded-lg text-gray-900 text-xs px-3.5 py-2.5 focus:outline-none focus:border-gray-900 font-medium"
              >
                <option value="">All Status</option>
                <option value="ACTIVE">Live Only</option>
                <option value="FINISHED">Ended Only</option>
              </select>

              {/* Grid / Table Toggle */}
              <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50 p-1 text-xs">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3.5 py-1.5 rounded-md font-semibold cursor-pointer transition-colors ${
                    viewMode === 'grid' ? 'bg-gray-900 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Grid
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3.5 py-1.5 rounded-md font-semibold cursor-pointer transition-colors ${
                    viewMode === 'table' ? 'bg-gray-900 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Table
                </button>
              </div>
            </div>
          </div>

          {/* Results Grid / Table */}
          <div>
            <div className="flex items-center justify-between mb-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <span>
                Showing <strong className="text-gray-900 font-bold">{filteredData.length}</strong> Auction Lots
              </span>
            </div>

            {viewMode === 'grid' ? (
              filteredData.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
                  No auction lots match your search query.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {filteredData.map((auction) => (
                    <AuctionCard key={auction.id} auction={auction} />
                  ))}
                </div>
              )
            ) : (
              <DataTable
                columns={columns}
                data={filteredData}
                onRowClick={(row) => navigate(`/auction/${row.id}`)}
                emptyMessage="No auctions match your filters"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
