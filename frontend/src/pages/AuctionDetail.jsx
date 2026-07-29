import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getAuction, getAuctionHistory } from '../lib/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CountdownTimer from '../components/CountdownTimer';
import StatusStrip from '../components/StatusStrip';
import ImageCarousel from '../components/ImageCarousel';
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
  const { user } = useAuth();

  const [auction, setAuction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState('');
  const [currentBid, setCurrentBid] = useState(0);
  const [bidHistory, setBidHistory] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);

  /**
   * Processes incoming real-time WebSocket messages.
   * Defined with useCallback to maintain a stable reference and bypass React's state batching issues during high-throughput bidding.
   */
  const handleWebSocketMessage = useCallback((lastMessage) => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'AUCTION_SNAPSHOT':
        if (lastMessage.expiresAt && lastMessage.expiresAt > 0) {
          setExpiresAt(lastMessage.expiresAt);
        }
        if (lastMessage.currentHighestBid) {
          setCurrentBid(lastMessage.currentHighestBid);
        }
        break;

      case 'BID_ACK':
        setProcessing(false);
        addToast('Bid placed successfully!', 'success');
        break;

      case 'BID_REJECTED':
        setProcessing(false);
        addToast(lastMessage.reason || 'Bid rejected — too low', 'error');
        break;

      case 'LEADERBOARD_DELTA':
        if (lastMessage.leaderboard?.length > 0) {
          setCurrentBid(lastMessage.leaderboard[0].amount);
          setBidHistory((prev) => {
            const newBids = lastMessage.leaderboard.filter(
              (lb) => !prev.some((p) => Number(p.amount) === Number(lb.amount) && (p.userId === lb.userId || p.user_id === lb.userId))
            );
            if (newBids.length > 0) {
              return [...newBids, ...prev].sort((a, b) => new Date(b.timestamp || b.bid_timestamp || 0).getTime() - new Date(a.timestamp || a.bid_timestamp || 0).getTime() || b.amount - a.amount);
            }
            return prev;
          });
        }
        break;

      case 'NEW_BID_ATTEMPT':
        if (lastMessage.bid) {
          setBidHistory((prev) => {
            if (prev.some((p) => p.id === lastMessage.bid.id || (p.userId === lastMessage.bid.userId && Number(p.amount) === Number(lastMessage.bid.amount)))) {
              return prev;
            }
            return [lastMessage.bid, ...prev].sort((a, b) => new Date(b.timestamp || b.bid_timestamp || 0).getTime() - new Date(a.timestamp || a.bid_timestamp || 0).getTime() || b.amount - a.amount);
          });
        }
        break;

      case 'AUCTION_EXTENDED':
        if (lastMessage.newExpiresAt && lastMessage.newExpiresAt > 0) {
          setExpiresAt(lastMessage.newExpiresAt);
          addToast(' Auction extended — last-minute bid detected!', 'info');
        }
        break;

      case 'AUCTION_CONCLUDED':
        addToast('Auction has ended', 'info');
        setAuction((prev) => (prev ? { ...prev, status: 'FINISHED' } : prev));
        break;

      default:
        break;
    }
  }, [addToast]);

  const { isConnected, sendBid } = useWebSocket(id, handleWebSocketMessage);

  /**
   * Fetch initial auction details and bid history from the API.
   * This provides the foundational state before WebSocket real-time updates kick in.
   */
  useEffect(() => {
    setLoading(true);
    Promise.all([
      getAuction(id).catch(() => null),
      getAuctionHistory(id).catch(() => ({ history: [] })),
    ]).then(([auctionData, historyData]) => {
      if (auctionData && !auctionData.error) {
        setAuction(auctionData);
        setCurrentBid(auctionData.currentHighestBid || auctionData.startPrice || 0);
        setExpiresAt(auctionData.expiresAt || auctionData.endTime || 0);
      }
      if (historyData && Array.isArray(historyData.history)) {
        setBidHistory(historyData.history);
      }
    }).finally(() => {
      setLoading(false);
    });
  }, [id]);

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

    const activeUserId = user?.id || user?.sub || 'USR-a1b2';

    if (isConnected) {
      const sent = sendBid(activeUserId, amount);
      if (!sent) {
        setProcessing(false);
        addToast('Failed to send bid over WebSocket', 'error');
      }
    } else {
      setProcessing(false);
      addToast('Connecting to real-time bidding network...', 'info');
    }

    setBidAmount('');
  }

  function handleSubmitBid(e) {
    e.preventDefault();
    executeBid(parseFloat(bidAmount));
  }

  if (loading) {
    return (
      <div className="p-12 max-w-[1400px] mx-auto text-center space-y-4">
        <div className="inline-block w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-gray-500 font-mono text-sm">Fetching live auction telemetry from backend...</p>
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <p className="text-gray-500 text-sm">
          Auction lot not found on backend system.{' '}
          <Link to="/" className="text-gray-900 underline font-medium">
            Back to auctions
          </Link>
        </p>
      </div>
    );
  }

  const isFinished = auction.status === 'FINISHED' || (expiresAt > 0 && expiresAt <= Date.now());

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Breadcrumb & Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <div className="text-xs text-gray-500 flex items-center gap-1.5 mb-1 font-mono">
            <Link to="/" className="text-gray-900 hover:underline no-underline">
              Auctions
            </Link>
            <span>/</span>
            <span>{auction.category || 'Collectibles'}</span>
            <span>/</span>
            <span className="text-gray-900 font-semibold">{auction.id || auction.auctionId}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{auction.title}</h1>
            <Badge variant={isFinished ? 'closed' : 'live'} />
          </div>
        </div>

        <div className="flex items-center gap-4 bg-white border border-gray-200 px-4 py-2 shadow-xs">
          <div className="text-right">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">Ending In</div>
            <div className="text-lg font-bold font-mono text-gray-900">
              {isFinished ? 'Concluded' : <CountdownTimer expiresAt={expiresAt} />}
            </div>
            {auction.startTime && (
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                Started: {new Date(auction.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {expiresAt > 0 && (
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                {isFinished ? 'Ended' : 'Ends'}: {new Date(expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Left Item Showcase vs Right Live Bidding Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Columns: Product Photography & Provenance */}
        <div className="lg:col-span-7 space-y-6">
          <div className="border border-gray-200 bg-white p-3 shadow-xs">
            <div className="aspect-4/3 bg-gray-50 overflow-hidden border border-gray-200 relative">
              <ImageCarousel
                images={auction.images}
                name={auction.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 left-3 bg-gray-900/90 text-white text-xs font-mono px-2.5 py-1">
                LOT ID: {auction.id || auction.auctionId}
              </div>
            </div>
          </div>

          <div className="border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider border-b border-gray-200 pb-2">
              Lot Description & Condition
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed">{auction.description || 'No description provided.'}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 font-mono text-xs border-t border-gray-200">
              <div>
                <span className="text-[10px] text-gray-500 block uppercase">Starting Price</span>
                <span className="font-bold text-gray-900 text-sm">{formatCurrency(auction.startPrice)}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase">Category</span>
                <span className="font-bold text-gray-900 text-sm">{auction.category || 'Collectibles'}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase">Total Bids</span>
                <span className="font-bold text-gray-900 text-sm">{bidHistory.length}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase">Escrow Guarantee</span>
                <span className="font-bold text-gray-900 text-sm">Verified 100%</span>
              </div>
            </div>
          </div>

          <div className="border border-gray-200 bg-gray-50 p-4 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">
                
              </span>
              <div>
                <div className="font-semibold text-gray-900">Verified Provenance & Certificate</div>
                <div className="text-gray-500 text-[11px]">Inspected by independent horology & fine art specialists</div>
              </div>
            </div>
            <span className="font-mono text-[11px] text-gray-900 font-semibold hidden sm:inline">
              CERT #8849-B
            </span>
          </div>
        </div>

        {/* Right 5 Columns: Real-Time Bidding Control Terminal */}
        <div className="lg:col-span-5 space-y-5">
          <div className="border border-gray-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-mono text-gray-500 uppercase tracking-wider">
                CURRENT HIGHEST BID
              </span>
            </div>
            <div className="font-mono text-4xl font-extrabold text-gray-900 tracking-tight tabular-nums">
              {formatCurrency(currentBid)}
            </div>
            <div className="text-[11px] text-gray-500 mt-1 font-mono">
              Next Minimum Bid: <strong className="text-gray-900">{formatCurrency(currentBid + 100)}</strong>
            </div>
          </div>

          {!isFinished && (
            <div className="border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
              <div className="text-xs font-semibold text-gray-900 uppercase tracking-wider">
                Submit High-Throughput Bid
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[100, 500, 1000, 5000].map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => setBidAmount(currentBid + inc)}
                    disabled={processing}
                    className="border border-gray-200 bg-gray-50 hover:bg-gray-900 hover:text-white text-gray-900 font-mono text-xs py-1.5 font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    +${inc.toLocaleString()}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmitBid} className="space-y-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-mono text-sm">$</span>
                  <input
                    type="number"
                    step="1"
                    min={currentBid + 1}
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={`Custom Amount (e.g. ${(currentBid + 250).toLocaleString()})`}
                    className="w-full border border-gray-200 bg-white pl-8 pr-3 py-2.5 text-sm font-mono text-gray-900 focus:outline-none focus:border-gray-900 placeholder:text-gray-400"
                    disabled={processing}
                  />
                </div>

                <button
                  type="submit"
                  disabled={processing}
                  className="w-full bg-gray-900 hover:bg-black text-white font-mono font-bold text-sm py-3 uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {processing ? 'EXECUTING REDIS LUA LOCK...' : 'PLACE BID NOW'}
                </button>
              </form>
            </div>
          )}

          <StatusStrip processing={processing} />



          <div className="border border-gray-200 bg-white flex flex-col shadow-xs">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-900 uppercase tracking-wider">
                Live Audit Trail
              </span>
              <span className="text-[10px] font-mono text-gray-500">
                {bidHistory.length} ENTRIES
              </span>
            </div>

            <div className="overflow-y-auto max-h-[320px] divide-y divide-gray-100">
              {bidHistory.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-gray-500 font-mono">
                  No bids recorded yet. Be the first bidder!
                </div>
              ) : (
                bidHistory.map((bid, idx) => (
                  <div
                    key={bid.id || idx}
                    className={`px-4 py-2.5 flex items-center justify-between text-xs ${
                      idx === 0 ? 'bg-gray-100/80 font-semibold' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center font-mono text-[10px] overflow-hidden">
                        {bid.userAvatar ? (
                          <img src={bid.userAvatar} alt={bid.userName} className="w-full h-full object-cover" />
                        ) : (
                          (bid.userName || bid.userId || bid.user_id || 'US').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="font-mono text-gray-900">
                          {bid.userName || bid.userId || bid.user_id}{' '}
                          {idx === 0 && <span className="text-[10px] text-gray-600 font-bold ml-1">(HIGHEST)</span>}
                        </div>
                        <div className="text-[10px] font-mono text-gray-500">{formatTime(bid.timestamp)}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono font-bold text-sm text-gray-900">
                      {formatCurrency(parseFloat(bid.amount))}
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
