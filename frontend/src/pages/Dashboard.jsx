import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MOCK_AUCTIONS } from '../lib/mockData';
import { CATEGORIES } from '../lib/constants';
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
  if (auction.status === 'FINISHED') return 'closed';
  const remaining = auction.endTime - Date.now();
  if (remaining <= 60000) return 'closing-soon';
  return 'live';
}

const SORT_OPTIONS = [
  { value: 'endTime-asc', label: 'Ending Soon' },
  { value: 'currentHighestBid-desc', label: 'Highest Value' },
  { value: 'bidCount-desc', label: 'Most Bids' },
  { value: 'title-asc', label: 'Name A–Z' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortOption, setSortOption] = useState('endTime-asc');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'

  // Featured Item Spotlight (Highest bids or ending soon)
  const featuredAuction = useMemo(() => {
    return MOCK_AUCTIONS.find((a) => a.id === 'AUC-b82e44') || MOCK_AUCTIONS[0];
  }, []);

  const filteredData = useMemo(() => {
    let result = [...MOCK_AUCTIONS];

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
  }, [searchQuery, categoryFilter, sortOption, statusFilter]);

  const columns = [
    {
      key: 'title',
      label: 'Item',
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200">
            <PlaceholderImage src={row.image} name={val} size={40} className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="font-semibold text-[#12151C]">{val}</div>
            <div className="text-[11px] text-[#6B7280]">{row.category}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'id',
      label: 'ID',
      sortable: false,
      mono: true,
      render: (val) => <span className="text-[#6B7280] text-xs font-mono">{val}</span>,
    },
    {
      key: 'currentHighestBid',
      label: 'Current Bid',
      sortable: true,
      mono: true,
      align: 'right',
      render: (val) => formatCurrency(val),
    },
    {
      key: 'bidCount',
      label: 'Bids',
      sortable: true,
      mono: true,
      align: 'right',
    },
    {
      key: 'endTime',
      label: 'Time Left',
      sortable: true,
      render: (val, row) =>
        row.status === 'FINISHED' ? (
          <span className="font-mono text-xs text-[#6B7280]">Ended</span>
        ) : (
          <CountdownTimer expiresAt={val} compact />
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
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Featured Auction Spotlight Banner */}
      {featuredAuction && !searchQuery && !categoryFilter && (
        <div className="border border-slate-800 bg-[#12151C] text-white p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center shadow-lg">
          <div className="lg:col-span-5 aspect-16/10 bg-slate-900 overflow-hidden border border-slate-700 relative group">
            <PlaceholderImage
              src={featuredAuction.image}
              name={featuredAuction.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute top-3 left-3">
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono font-semibold px-2 py-0.5 uppercase tracking-widest">
                ★ FEATURED LOT
              </span>
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center gap-3 text-xs text-slate-400 font-mono mb-2">
                <span>{featuredAuction.id}</span>
                <span>•</span>
                <span className="text-emerald-400">{featuredAuction.category}</span>
                <span>•</span>
                <span>{featuredAuction.bidCount} Bids</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">{featuredAuction.title}</h2>
              <p className="text-slate-300 text-xs mt-2 line-clamp-2 leading-relaxed">
                {featuredAuction.description}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 py-3 border-y border-slate-800">
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Current Bid</div>
                <div className="font-mono text-2xl font-bold text-white mt-0.5">
                  {formatCurrency(featuredAuction.currentHighestBid)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Ending In</div>
                <div className="mt-1 text-base font-mono">
                  <CountdownTimer expiresAt={featuredAuction.endTime} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => navigate(`/auction/${featuredAuction.id}`)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-5 py-2.5 font-mono uppercase tracking-wider transition-colors cursor-pointer"
              >
                Place Bid Now →
              </button>
              <button
                onClick={() => navigate(`/auction/${featuredAuction.id}`)}
                className="border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-mono px-4 py-2.5 transition-colors cursor-pointer"
              >
                Inspect Provenance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Pills Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
          onClick={() => setCategoryFilter('')}
          className={`px-3 py-1.5 font-medium transition-colors cursor-pointer border ${
            categoryFilter === ''
              ? 'bg-[#1A2B4C] text-white border-[#1A2B4C]'
              : 'bg-white text-[#6B7280] border-[#E2E4E9] hover:text-[#12151C]'
          }`}
        >
          All Categories ({MOCK_AUCTIONS.length})
        </button>
        {CATEGORIES.map((cat) => {
          const count = MOCK_AUCTIONS.filter((a) => a.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
              className={`px-3 py-1.5 font-medium transition-colors cursor-pointer border whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-[#1A2B4C] text-white border-[#1A2B4C]'
                  : 'bg-white text-[#6B7280] border-[#E2E4E9] hover:text-[#12151C]'
              }`}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Header + Control Toolbar */}
      <div className="bg-white border border-[#E2E4E9] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        {/* Search Bar */}
        <div className="relative min-w-[280px] flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lot title, ID, category..."
            className="w-full border border-[#E2E4E9] bg-[#F7F8FA] text-[#12151C] text-xs px-3.5 py-2 pr-8 focus:outline-none focus:border-[#1A2B4C] focus:bg-white placeholder:text-[#9CA3AF]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#12151C] text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filters & View Switcher */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            className="border border-[#E2E4E9] bg-white text-[#12151C] text-xs px-3 py-2 focus:outline-none focus:border-[#1A2B4C]"
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
            className="border border-[#E2E4E9] bg-white text-[#12151C] text-xs px-3 py-2 focus:outline-none focus:border-[#1A2B4C]"
          >
            <option value="">All Status</option>
            <option value="ACTIVE">Live Only</option>
            <option value="FINISHED">Ended Only</option>
          </select>

          {/* View Toggle */}
          <div className="flex items-center border border-[#E2E4E9] bg-[#F7F8FA] p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                viewMode === 'grid' ? 'bg-[#1A2B4C] text-white shadow-xs' : 'text-[#6B7280] hover:text-[#12151C]'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                viewMode === 'table' ? 'bg-[#1A2B4C] text-white shadow-xs' : 'text-[#6B7280] hover:text-[#12151C]'
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Items Section */}
      <div>
        <div className="flex items-center justify-between mb-3 text-xs text-[#6B7280]">
          <span>
            SHOWING <strong className="text-[#12151C] font-mono">{filteredData.length}</strong> AUCTION LOTS
          </span>
        </div>

        {viewMode === 'grid' ? (
          filteredData.length === 0 ? (
            <div className="border border-[#E2E4E9] bg-white p-12 text-center text-sm text-[#6B7280]">
              No auction lots match your search filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
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
    </div>
  );
}
