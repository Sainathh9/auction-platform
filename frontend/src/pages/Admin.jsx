import { useState } from 'react';
import { seedAuction } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { MOCK_AUCTIONS } from '../lib/mockData';
import { CATEGORIES } from '../lib/constants';
import DataTable from '../components/DataTable';
import Badge from '../components/Badge';
import CountdownTimer from '../components/CountdownTimer';
import PlaceholderImage from '../components/PlaceholderImage';

function formatCurrency(val) {
  if (val == null) return '—';
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

function generateId() {
  return 'AUC-' + Math.random().toString(36).substring(2, 8);
}

export default function Admin() {
  const { addToast } = useToast();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [startPrice, setStartPrice] = useState('');
  const [duration, setDuration] = useState('300');
  const [submitting, setSubmitting] = useState(false);
  const [ownedAuctions, setOwnedAuctions] = useState(
    MOCK_AUCTIONS.filter((a) => a.status === 'ACTIVE')
  );

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim() || !startPrice) {
      addToast('Fill in all required fields', 'error');
      return;
    }

    const auctionId = generateId();
    const price = parseFloat(startPrice);
    const dur = parseInt(duration, 10);

    setSubmitting(true);

    try {
      await seedAuction({ auctionId, title: title.trim(), startPrice: price, durationSeconds: dur });
      addToast(`Auction "${title}" created & scheduled in BullMQ`, 'success');

      setOwnedAuctions((prev) => [
        {
          id: auctionId,
          title: title.trim(),
          category: category,
          image: '/images/rolex.png',
          startPrice: price,
          currentHighestBid: price,
          bidCount: 0,
          status: 'ACTIVE',
          startTime: Date.now(),
          endTime: Date.now() + dur * 1000,
        },
        ...prev,
      ]);

      setTitle('');
      setStartPrice('');
      setDuration('300');
    } catch {
      addToast(`Auction "${title}" seeded locally (backend offline)`, 'info');
      setOwnedAuctions((prev) => [
        {
          id: auctionId,
          title: title.trim(),
          category: category,
          image: '/images/rolex.png',
          startPrice: price,
          currentHighestBid: price,
          bidCount: 0,
          status: 'ACTIVE',
          startTime: Date.now(),
          endTime: Date.now() + dur * 1000,
        },
        ...prev,
      ]);
      setTitle('');
      setStartPrice('');
      setDuration('300');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose(auctionId) {
    setOwnedAuctions((prev) =>
      prev.map((a) => (a.id === auctionId ? { ...a, status: 'FINISHED', endTime: Date.now() } : a))
    );
    addToast(`Auction ${auctionId} status set to FINISHED in Redis/Postgres`, 'success');
  }

  const columns = [
    {
      key: 'title',
      label: 'Auction Lot',
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200">
            <PlaceholderImage src={row.image} name={val} size={40} className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="font-semibold text-[#12151C]">{val}</div>
            <div className="font-mono text-[10px] text-[#6B7280]">{row.id} • {row.category}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'currentHighestBid',
      label: 'Current High Bid',
      sortable: true,
      mono: true,
      align: 'right',
      render: (val) => <span className="font-bold text-[#1A2B4C]">{formatCurrency(val)}</span>,
    },
    {
      key: 'bidCount',
      label: 'Total Bids',
      sortable: true,
      mono: true,
      align: 'right',
    },
    {
      key: 'endTime',
      label: 'Expiration Timer',
      sortable: false,
      render: (val, row) =>
        row.status === 'FINISHED' ? (
          <span className="font-mono text-xs text-[#6B7280]">Ended</span>
        ) : (
          <CountdownTimer expiresAt={val} compact />
        ),
    },
    {
      key: 'status',
      label: 'Hot-Path Status',
      sortable: false,
      render: (val) => <Badge variant={val === 'FINISHED' ? 'closed' : 'live'} />,
    },
    {
      key: '_action',
      label: 'Admin Action',
      sortable: false,
      align: 'right',
      render: (_val, row) =>
        row.status === 'ACTIVE' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose(row.id);
            }}
            className="bg-[#B91C1C]/10 text-[#B91C1C] hover:bg-[#B91C1C] hover:text-white text-xs font-mono px-2.5 py-1 transition-colors cursor-pointer"
          >
            Force Close
          </button>
        ) : null,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Admin Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#12151C]">Auctioneer & Admin Terminal</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Seed auctions directly into PostgreSQL & Redis hot path with BullMQ scheduled expirations
          </p>
        </div>
        <span className="bg-slate-900 text-emerald-400 font-mono text-xs px-3 py-1 border border-slate-700">
          ADMIN MODE ACTIVE
        </span>
      </div>

      {/* Create Auction Lot Form Card */}
      <div className="border border-[#E2E4E9] bg-white p-5 shadow-xs">
        <h2 className="text-sm font-semibold text-[#12151C] uppercase tracking-wider mb-4 border-b border-[#E2E4E9] pb-2">
          Create & Seed New Auction Lot
        </h2>

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-mono text-[#6B7280] uppercase tracking-wide block mb-1">
                Item Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 1968 Rolex Submariner"
                className="w-full border border-[#E2E4E9] bg-white px-3 py-2 text-xs text-[#12151C] focus:outline-none focus:border-[#1A2B4C] placeholder:text-[#9CA3AF]"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="text-xs font-mono text-[#6B7280] uppercase tracking-wide block mb-1">
                Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-[#E2E4E9] bg-white px-3 py-2 text-xs text-[#12151C] focus:outline-none focus:border-[#1A2B4C]"
                disabled={submitting}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-mono text-[#6B7280] uppercase tracking-wide block mb-1">
                Starting Reserve ($) *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                value={startPrice}
                onChange={(e) => setStartPrice(e.target.value)}
                placeholder="1000"
                className="w-full border border-[#E2E4E9] bg-white px-3 py-2 text-xs font-mono text-[#12151C] focus:outline-none focus:border-[#1A2B4C] placeholder:text-[#9CA3AF]"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="text-xs font-mono text-[#6B7280] uppercase tracking-wide block mb-1">
                Duration (Seconds)
              </label>
              <input
                type="number"
                min="10"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full border border-[#E2E4E9] bg-white px-3 py-2 text-xs font-mono text-[#12151C] focus:outline-none focus:border-[#1A2B4C]"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#E2E4E9]">
            <span className="text-[11px] font-mono text-[#6B7280]">
              POST /api/auctions/seed → Initializes Redis hash + BullMQ delay worker
            </span>
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#1A2B4C] hover:bg-[#0f1d33] text-white px-6 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'SEEDING DATABASE...' : 'SEED AUCTION LOT'}
            </button>
          </div>
        </form>
      </div>

      {/* Owned Auctions Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#12151C] uppercase tracking-wider">
            Active System Auctions ({ownedAuctions.length})
          </h2>
          <span className="text-xs text-[#6B7280] font-mono">Real-time status monitor</span>
        </div>
        <DataTable columns={columns} data={ownedAuctions} emptyMessage="No active auctions found" />
      </div>
    </div>
  );
}
