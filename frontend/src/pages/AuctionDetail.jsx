import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MOCK_AUCTIONS, getMockBidHistory } from '../lib/mockData';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../context/ToastContext';
import CountdownTimer from '../components/CountdownTimer';
import StatusStrip from '../components/StatusStrip';
import PlaceholderImage from '../components/PlaceholderImage';
import Badge from '../components/Badge';

function formatCurrency(val) {
  if (val == null) return '—';
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function AuctionDetail() {
  const { id } = useParams();
  const { addToast } = useToast();
  const auction = MOCK_AUCTIONS.find((a) => a.id === id);

  const [bidAmount, setBidAmount] = useState('');
  const [bidHistory, setBidHistory] = useState(() => getMockBidHistory(id));
  const [currentBid, setCurrentBid] = useState(auction?.currentHighestBid || 0);
  const [processing, setProcessing] = useState(false);
  const [expiresAt, setExpiresAt] = useState(auction?.endTime || 0);
  const feedRef = useRef(null);

  const { isConnected, lastMessage, sendBid } = useWebSocket(id);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'BID_ACK':
        setProcessing(false);
        setCurrentBid(lastMessage.amount);
        addToast(`Bid of ${formatCurrency(lastMessage.amount)} accepted`, 'success');
        break;

      case 'BID_REJECTED':
        setProcessing(false);
        addToast(lastMessage.reason || 'Bid rejected — too low', 'error');
        break;

      case 'AUCTION_EXPIRED':
        setProcessing(false);
        addToast('This auction has concluded', 'info');
        break;

      case 'LEADERBOARD_DELTA':
        if (lastMessage.leaderboard?.length > 0) {
          setCurrentBid(lastMessage.leaderboard[0].amount);
          setBidHistory((prev) => {
            const newEntries = lastMessage.leaderboard
              .map((entry) => ({
                id: `ws-${entry.userId}-${entry.timestamp}`,
                userId: entry.userId,
                amount: entry.amount,
                timestamp: entry.timestamp,
                status: 'ACCEPTED',
              }))
              .filter((entry) => !prev.some((p) => p.id === entry.id));
            return [...newEntries, ...prev].slice(0, 50);
          });
        }
        break;

      case 'AUCTION_EXTENDED':
        if (lastMessage.newExpiresAt) {
          setExpiresAt(lastMessage.newExpiresAt);
          addToast('Anti-sniping: auction extended by 30s', 'info');
        }
        break;

      case 'AUCTION_CONCLUDED':
        addToast('Auction has concluded', 'info');
        break;

      case 'ERROR':
        setProcessing(false);
        addToast(lastMessage.reason || 'Error processing bid', 'error');
        break;

      default:
        break;
    }
  }, [lastMessage, addToast]);

  function executeBid(amount) {
    if (isNaN(amount) || amount <= 0) {
      addToast('Enter a valid bid amount', 'error');
      return;
    }
    if (amount <= currentBid) {
      addToast(`Bid must exceed current highest: ${formatCurrency(currentBid)}`, 'error');
      return;
    }

    setProcessing(true);

    if (isConnected) {
      sendBid('dev-user-1', amount);
    } else {
      // Mock: simulate bid processing
      setTimeout(() => {
        setProcessing(false);
        setCurrentBid(amount);
        setBidHistory((prev) => [
          {
            id: `mock-${Date.now()}`,
            userId: 'USR-a1b2',
            amount,
            timestamp: Date.now(),
            status: 'ACCEPTED',
          },
          ...prev,
        ]);
        addToast(`Bid of ${formatCurrency(amount)} placed (mock)`, 'success');
      }, 700);
    }

    setBidAmount('');
  }

  function handleSubmitBid(e) {
    e.preventDefault();
    executeBid(parseFloat(bidAmount));
  }

  if (!auction) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <p className="text-[#6B7280] text-sm">
          Auction lot not found.{' '}
          <Link to="/" className="text-[#1A2B4C] underline font-medium">
            Back to auctions
          </Link>
        </p>
      </div>
    );
  }

  const isFinished = auction.status === 'FINISHED' || expiresAt <= Date.now();

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Breadcrumb & Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E2E4E9] pb-4">
        <div>
          <div className="text-xs text-[#6B7280] flex items-center gap-1.5 mb-1 font-mono">
            <Link to="/" className="text-[#1A2B4C] hover:underline no-underline">
              Auctions
            </Link>
            <span>/</span>
            <span>{auction.category}</span>
            <span>/</span>
            <span className="text-[#12151C]">{auction.id}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#12151C] tracking-tight">{auction.title}</h1>
            <Badge variant={isFinished ? 'closed' : 'live'} />
          </div>
        </div>

        <div className="flex items-center gap-4 bg-white border border-[#E2E4E9] px-4 py-2 shadow-xs">
          <div className="text-right">
            <div className="text-[10px] text-[#6B7280] uppercase tracking-wider font-mono">Ending In</div>
            <div className="text-lg font-bold font-mono text-[#12151C]">
              {isFinished ? 'Concluded' : <CountdownTimer expiresAt={expiresAt} />}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Item Showcase vs Right Live Bidding Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Columns: Product Photography & Provenance */}
        <div className="lg:col-span-7 space-y-6">
          {/* Main High-Res Image Display */}
          <div className="border border-[#E2E4E9] bg-white p-3 shadow-xs">
            <div className="aspect-4/3 bg-[#F7F8FA] overflow-hidden border border-[#E2E4E9] relative">
              <PlaceholderImage
                src={auction.image}
                name={auction.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 left-3 bg-[#12151C]/80 backdrop-blur-xs text-white text-xs font-mono px-2.5 py-1">
                LOT ID: {auction.id}
              </div>
            </div>
          </div>

          {/* Description & Overview */}
          <div className="border border-[#E2E4E9] bg-white p-5 space-y-4 shadow-xs">
            <h3 className="text-sm font-semibold text-[#12151C] uppercase tracking-wider border-b border-[#E2E4E9] pb-2">
              Lot Description & Condition
            </h3>
            <p className="text-sm text-[#374151] leading-relaxed">{auction.description}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 font-mono text-xs border-t border-[#E2E4E9]">
              <div>
                <span className="text-[10px] text-[#6B7280] block uppercase">Starting Price</span>
                <span className="font-bold text-[#12151C] text-sm">{formatCurrency(auction.startPrice)}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#6B7280] block uppercase">Category</span>
                <span className="font-bold text-[#12151C] text-sm">{auction.category}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#6B7280] block uppercase">Total Bids</span>
                <span className="font-bold text-[#12151C] text-sm">{bidHistory.length}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#6B7280] block uppercase">Escrow Guarantee</span>
                <span className="font-bold text-emerald-700 text-sm">Verified 100%</span>
              </div>
            </div>
          </div>

          {/* Authenticity & Escrow Card */}
          <div className="border border-[#E2E4E9] bg-[#F7F8FA] p-4 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[#1A2B4C] text-white flex items-center justify-center font-bold">
                ✓
              </span>
              <div>
                <div className="font-semibold text-[#12151C]">Verified Provenance & Certificate</div>
                <div className="text-[#6B7280] text-[11px]">Inspected by independent horology & fine art specialists</div>
              </div>
            </div>
            <span className="font-mono text-[11px] text-[#1A2B4C] font-semibold hidden sm:inline">
              CERT #8849-B
            </span>
          </div>
        </div>

        {/* Right 5 Columns: Real-Time Bidding Control Terminal */}
        <div className="lg:col-span-5 space-y-5">
          {/* Current Highest Price Terminal Box */}
          <div className="border border-[#E2E4E9] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-mono text-[#6B7280] uppercase tracking-wider">
                CURRENT HIGHEST BID
              </span>
              <span className="text-[11px] font-mono text-emerald-700 font-medium">LIVE AUCTION</span>
            </div>
            <div className="font-mono text-4xl font-extrabold text-[#1A2B4C] tracking-tight tabular-nums">
              {formatCurrency(currentBid)}
            </div>
            <div className="text-[11px] text-[#6B7280] mt-1 font-mono">
              Next Minimum Bid: <strong className="text-[#12151C]">{formatCurrency(currentBid + 100)}</strong>
            </div>
          </div>

          {/* Bidding Execution Form */}
          {!isFinished && (
            <div className="border border-[#E2E4E9] bg-white p-5 space-y-4 shadow-xs">
              <div className="text-xs font-semibold text-[#12151C] uppercase tracking-wider">
                Submit High-Throughput Bid
              </div>

              {/* Preset Increments */}
              <div className="grid grid-cols-4 gap-2">
                {[100, 500, 1000, 5000].map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => executeBid(currentBid + inc)}
                    disabled={processing}
                    className="border border-[#E2E4E9] bg-[#F7F8FA] hover:bg-[#1A2B4C] hover:text-white text-[#12151C] font-mono text-xs py-1.5 font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    +${inc.toLocaleString()}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmitBid} className="space-y-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] font-mono text-sm">$</span>
                  <input
                    type="number"
                    step="1"
                    min={currentBid + 1}
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={`Custom Amount (e.g. ${(currentBid + 250).toLocaleString()})`}
                    className="w-full border border-[#E2E4E9] bg-white pl-8 pr-3 py-2.5 text-sm font-mono text-[#12151C] focus:outline-none focus:border-[#1A2B4C] placeholder:text-[#9CA3AF]"
                    disabled={processing}
                  />
                </div>

                <button
                  type="submit"
                  disabled={processing}
                  className="w-full bg-[#1A2B4C] hover:bg-[#0f1d33] text-white font-mono font-bold text-sm py-3 uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {processing ? 'EXECUTING REDIS LUA LOCK...' : 'PLACE BID NOW'}
                </button>
              </form>
            </div>
          )}

          {/* Telemetry Status Strip */}
          <StatusStrip processing={processing} />

          {/* Engine Architecture Telemetry Card */}
          <div className="border border-slate-200 bg-slate-50 p-3.5 text-[11px] font-mono text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800 uppercase tracking-wider text-[10px] mb-1">
              BACKEND CONCURRENCY TELEMETRY
            </div>
            <div className="flex justify-between">
              <span>Hot-Path Execution:</span>
              <span className="text-emerald-700 font-bold">Redis Lua Atomic Script</span>
            </div>
            <div className="flex justify-between">
              <span>System of Record:</span>
              <span className="text-slate-800">PostgreSQL (Row Lock)</span>
            </div>
            <div className="flex justify-between">
              <span>Event Durability:</span>
              <span className="text-slate-800">Kafka Worker Pipeline</span>
            </div>
          </div>

          {/* Real-time Bid History Feed */}
          <div className="border border-[#E2E4E9] bg-white flex flex-col shadow-xs">
            <div className="px-4 py-2.5 border-b border-[#E2E4E9] bg-[#F7F8FA] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#12151C] uppercase tracking-wider">
                Live Audit Trail
              </span>
              <span className="text-[10px] font-mono text-[#6B7280]">
                {bidHistory.length} ENTRIES
              </span>
            </div>

            <div ref={feedRef} className="overflow-y-auto max-h-[320px] divide-y divide-[#E2E4E9]">
              {bidHistory.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-[#6B7280] font-mono">
                  No bids recorded yet. Be the first bidder!
                </div>
              ) : (
                bidHistory.map((bid, idx) => (
                  <div
                    key={bid.id}
                    className={`px-4 py-2.5 flex items-center justify-between text-xs ${
                      idx === 0 ? 'bg-emerald-50/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-[#1A2B4C] text-white flex items-center justify-center font-mono text-[10px]">
                        {bid.userId.slice(-2)}
                      </div>
                      <div>
                        <div className="font-mono font-semibold text-[#12151C]">
                          {bid.userId} {idx === 0 && <span className="text-[10px] text-emerald-700 font-bold ml-1">★ HIGHEST</span>}
                        </div>
                        <div className="text-[10px] font-mono text-[#6B7280]">{formatTime(bid.timestamp)}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono font-bold text-sm text-[#1A2B4C]">
                      {formatCurrency(bid.amount)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
