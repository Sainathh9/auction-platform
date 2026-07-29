import { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { seedAuction, getAllAuctions, recoverAuction, getCategories, uploadImages } from '../lib/api';
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

// Returns a datetime-local string for <input type="datetime-local"> offset by `minutesOffset`
function localDatetimeValue(minutesOffset = 0) {
  const d = new Date(Date.now() + minutesOffset * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Admin() {
  const { addToast } = useToast();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState([]);
  const [startPrice, setStartPrice] = useState('');
  const [startDatetime, setStartDatetime] = useState(() => localDatetimeValue(0));
  const [endDatetime, setEndDatetime] = useState(() => localDatetimeValue(60));
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [ownedAuctions, setOwnedAuctions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch active auctions from backend API on mount
  const fetchAuctions = () => {
    setLoading(true);
    Promise.all([getAllAuctions(), getCategories()])
      .then(([auctionData, catData]) => {
        if (Array.isArray(auctionData)) setOwnedAuctions(auctionData);
        if (Array.isArray(catData)) {
          const defaultCats = ['Art', 'Collectibles', 'Electronics', 'Jewelry', 'Real Estate', 'Vehicles'];
          const merged = Array.from(new Set([...defaultCats, ...catData])).sort();
          setCategories(merged);
          if (!category) setCategory(merged[0]);
        }
      })
      .catch((err) => {
        console.error('Failed to load data from backend', err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAuctions();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim() || !startPrice || !startDatetime || !endDatetime) {
      addToast('Fill in all required fields', 'error');
      return;
    }

    const startMs = new Date(startDatetime).getTime();
    const endMs = new Date(endDatetime).getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
      addToast('Invalid date values', 'error');
      return;
    }
    if (endMs <= startMs) {
      addToast('End time must be after start time', 'error');
      return;
    }
    if (endMs <= Date.now()) {
      addToast('End time must be in the future', 'error');
      return;
    }

    const auctionId = generateId();
    const price = parseFloat(startPrice);

    setSubmitting(true);

    try {
      let parsedImages = ['/images/placeholder.png'];
      if (selectedFiles && selectedFiles.length > 0) {
        const uploadRes = await uploadImages(selectedFiles);
        if (uploadRes && uploadRes.urls && uploadRes.urls.length > 0) {
          parsedImages = uploadRes.urls;
        }
      }

      await seedAuction({
        auctionId,
        title: title.trim(),
        category,
        images: parsedImages,
        description: description.trim() || `Created via Admin Terminal on ${new Date().toLocaleString()}`,
        startPrice: price,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      });
      addToast(`Auction "${title}" created & scheduled in BullMQ worker`, 'success');
      fetchAuctions();
    } catch (err) {
      addToast(err.message || `Failed to create auction`, 'error');
    } finally {
      setTitle('');
      setDescription('');
      setStartPrice('');
      setStartDatetime(localDatetimeValue(0));
      setEndDatetime(localDatetimeValue(60));
      setSelectedFiles([]);
      setSubmitting(false);
    }
  }

  async function handleRecover(auctionId) {
    try {
      await recoverAuction(auctionId);
      addToast(`Hot Path state engine for ${auctionId} rehydrated in Redis`, 'success');
      fetchAuctions();
    } catch (err) {
      addToast(`Failed to recover auction: ${err.message}`, 'error');
    }
  }

  const columns = [
    {
      key: 'title',
      label: 'Auction Lot',
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200">
            <PlaceholderImage src={row.images?.[0]} name={val} size={40} className="w-full h-full object-cover" />
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
      key: 'startTime',
      label: 'Start Time',
      sortable: true,
      render: (val) => (
        <span className="text-xs text-[#6B7280] font-mono">
          {val ? new Date(val).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
        </span>
      ),
    },
    {
      key: 'endTime',
      label: 'End Time / Timer',
      sortable: false,
      render: (val, row) =>
        row.status === 'FINISHED' ? (
          <span className="font-mono text-xs text-[#6B7280]">
            Ended {val ? new Date(val).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : ''}
          </span>
        ) : (
          <div>
            <CountdownTimer expiresAt={val} compact />
            <div className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">
              {val ? new Date(val).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : ''}
            </div>
          </div>
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
    <div className="p-6 max-w-[1400px] mx-auto space-y-8">
      {/* Admin Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Auctioneer Terminal</h1>
          <p className="text-sm text-gray-500 mt-1">
            Seed auctions into PostgreSQL & Redis with BullMQ scheduled expiry
          </p>
        </div>

      </div>

      {/* Create Auction Card — Premium Dark Theme */}
      <div className="rounded-2xl overflow-hidden shadow-xl border border-gray-200">
        {/* Card Header */}
        <div className="bg-gray-950 px-8 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-base tracking-tight">Create New Auction Lot</h2>
            <p className="text-gray-400 text-xs mt-0.5 font-mono">POST /api/auctions/seed</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          </div>
        </div>

        {/* Card Body */}
        <div className="bg-gray-50 px-8 py-7">
          <form onSubmit={handleCreate} className="space-y-6">
            {/* Row 1: Title, Category, Starting Price */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="sm:col-span-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Item Title <span className="text-gray-900">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. 1968 Rolex Submariner"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent placeholder:text-gray-400 transition-all"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Category <span className="text-gray-900">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                  disabled={submitting}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter detailed description about the item..."
                  rows={3}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent placeholder:text-gray-400 transition-all resize-none"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Starting Price ($) <span className="text-gray-900">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm">$</span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={startPrice}
                    onChange={(e) => setStartPrice(e.target.value)}
                    placeholder="1,000"
                    className="w-full bg-white border border-gray-200 rounded-xl pl-8 pr-4 py-3 text-sm font-mono text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent placeholder:text-gray-400 transition-all"
                    disabled={submitting}
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Start + End Datetime */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Start Date & Time <span className="text-gray-900">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={startDatetime}
                  onChange={(e) => setStartDatetime(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  End Date & Time <span className="text-gray-900">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={endDatetime}
                  onChange={(e) => setEndDatetime(e.target.value)}
                  min={startDatetime}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                  disabled={submitting}
                />
                {startDatetime && endDatetime && new Date(endDatetime) > new Date(startDatetime) && (
                  <p className="text-xs text-emerald-600 font-mono mt-2 flex items-center gap-1.5">
                    <span>⏱</span>
                    Duration: {Math.round((new Date(endDatetime) - new Date(startDatetime)) / 60000)} minutes
                  </p>
                )}
              </div>
            </div>

            {/* Row 3: Images */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                Images (Upload multiple)
              </label>
              <div className="relative group">
                <input
                  type="file"
                  id="image-upload"
                  multiple
                  accept="image/jpeg, image/png, image/webp"
                  onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
                  className="hidden"
                  disabled={submitting}
                />
                <label
                  htmlFor="image-upload"
                  className="w-full flex items-center justify-center gap-3 bg-white border border-dashed border-gray-300 rounded-xl px-4 py-8 text-sm text-gray-900 shadow-sm cursor-pointer hover:bg-gray-50 hover:border-gray-400 transition-all focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent group-hover:shadow-md"
                >
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="font-medium text-gray-700">
                    {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : 'Click to select images'}
                  </span>
                </label>
                {selectedFiles.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    {selectedFiles.map((f, i) => (
                      <div key={i} className="relative w-12 h-12 rounded-lg border border-gray-200 overflow-hidden shrink-0">
                        <img src={URL.createObjectURL(f)} alt="preview" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Submit Row */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-400 font-mono hidden sm:block">
                BullMQ worker fires at exact end time → Kafka settlement event published
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="bg-gray-950 hover:bg-gray-800 text-white px-8 py-3 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                    Seeding…
                  </>
                ) : (
                  <>
                    <span>＋</span>
                    Seed Auction Lot
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
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
