import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getUserBidsApi, getAllAuctions } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import DataTable from '../components/DataTable';
import Badge from '../components/Badge';
import CountdownTimer from '../components/CountdownTimer';
import PlaceholderImage from '../components/PlaceholderImage';

function formatCurrency(val) {
  if (val == null) return '—';
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getAuctionStatusVariant(auction) {
  if (!auction) return 'ended';
  if (auction.status === 'FINISHED') return 'ended';
  const remaining = (auction.endTime || auction.expiresAt) - Date.now();
  if (remaining <= 0) return 'ended';
  if (remaining <= 60000) return 'closing-soon';
  return 'ongoing';
}

function resolveBidStatusVariant(bid, auction) {
  const auctionEnded =
    !auction ||
    auction.status === 'FINISHED' ||
    ((auction.endTime || auction.expiresAt) <= Date.now());

  const isHighestBid = auction ? Number(bid.amount) >= Number(auction.current_highest_bid || 0) : false;

  if (auctionEnded) {
    return isHighestBid ? 'won' : 'lost';
  }

  return isHighestBid ? 'winning' : 'outbid';
}

export default function MyBids() {
  const { user } = useAuth();
  const [userBids, setUserBids] = useState([]);
  const [auctionsMap, setAuctionsMap] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch real user bids and all catalog auctions from backend database on mount
  useEffect(() => {
    setLoading(true);
    const userId = user?.id || user?.sub;
    Promise.all([
      getUserBidsApi(userId).catch(() => []),
      getAllAuctions().catch(() => []),
    ]).then(([bidsData, auctionsData]) => {
      if (Array.isArray(bidsData)) {
        setUserBids(bidsData);
      }
      if (Array.isArray(auctionsData)) {
        const map = {};
        auctionsData.forEach((a) => {
          map[a.id] = a;
        });
        setAuctionsMap(map);
      }
    }).finally(() => {
      setLoading(false);
    });
  }, [user]);

  // Compute summary stats (Group by auction to prevent duplicate bid addition)
  const winningBids = useMemo(() => {
    // Only consider the bids where this user is actually the highest bidder for that auction
    const activeHighestBids = userBids.filter((b) => {
      const item = auctionsMap[b.auctionId];
      if (!item) return false;
      const isEnded = item.status === 'FINISHED' || ((item.endTime || item.expiresAt) <= Date.now());
      if (isEnded) return false; // Capital is only 'active' if the auction is ongoing
      return Number(b.amount) >= Number(item.current_highest_bid || 0);
    });

    const maxBidsMap = {};
    for (const b of activeHighestBids) {
      const amt = parseFloat(b.amount || 0);
      if (!maxBidsMap[b.auctionId] || amt > maxBidsMap[b.auctionId].amount) {
        maxBidsMap[b.auctionId] = { ...b, amount: amt };
      }
    }
    return Object.values(maxBidsMap);
  }, [userBids, auctionsMap]);

  const totalCommitted = useMemo(() => {
    return winningBids.reduce((sum, b) => sum + b.amount, 0);
  }, [winningBids]);

  const columns = [
    {
      key: 'auctionTitle',
      label: 'Auction Lot',
      sortable: true,
      render: (val, row) => {
        const item = auctionsMap[row.auctionId];
        const title = val || item?.title || row.auctionId;
        return (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 flex-shrink-0 overflow-hidden border border-gray-200 rounded">
              <PlaceholderImage src={item?.image} name={title} size={40} className="w-full h-full object-cover" />
            </div>
            <div>
              <Link to={`/auction/${row.auctionId}`} className="font-semibold text-gray-900 hover:underline no-underline text-sm block">
                {title}
              </Link>
              <div className="text-[11px] text-gray-500 font-medium">{row.auctionId}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'auctionStatus',
      label: 'Auction State',
      sortable: true,
      render: (_val, row) => {
        const item = auctionsMap[row.auctionId];
        const variant = getAuctionStatusVariant(item);
        return <Badge variant={variant} />;
      },
    },
    {
      key: 'timeLeft',
      label: 'Time Remaining / Ends',
      sortable: true,
      render: (_val, row) => {
        const item = auctionsMap[row.auctionId];
        const endTime = item?.endTime || item?.expiresAt;
        if (!item || item.status === 'FINISHED' || (endTime && endTime <= Date.now())) {
          return <span className="text-xs text-gray-500 font-medium">Ended ({formatTimestamp(endTime || row.timestamp)})</span>;
        }
        return <CountdownTimer expiresAt={endTime} compact />;
      },
    },
    {
      key: 'amount',
      label: 'My Bid Amount',
      sortable: true,
      align: 'right',
      render: (val) => <span className="font-bold text-gray-900">{formatCurrency(parseFloat(val))}</span>,
    },
    {
      key: 'status',
      label: 'My Status',
      sortable: true,
      render: (val, row) => {
        const item = auctionsMap[row.auctionId];
        return <Badge variant={resolveBidStatusVariant(row, item)} />;
      },
    },
    {
      key: 'timestamp',
      label: 'Placed At',
      sortable: true,
      render: (val) => <span className="text-xs text-gray-500 font-medium">{formatTimestamp(val)}</span>,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-900">My Bidding Activity</h1>
          <p className="text-xs text-gray-500 mt-0.5 font-medium">Real-time database log tracking for open, ongoing, and ended auctions</p>
        </div>
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
          TOTAL BIDS: <strong className="text-gray-900">{userBids.length}</strong>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="border border-gray-200 bg-white p-5 rounded-xl shadow-xs">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Currently Winning / Accepted</div>
          <div className="text-3xl font-extrabold text-gray-900 mt-1">{winningBids.length} Lots</div>
        </div>
        <div className="border border-gray-200 bg-white p-5 rounded-xl shadow-xs">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Capital Committed</div>
          <div className="text-3xl font-extrabold text-gray-900 mt-1">{formatCurrency(totalCommitted)}</div>
        </div>
        <div className="border border-gray-200 bg-white p-5 rounded-xl shadow-xs">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Outbid Alerts</div>
          <div className="text-3xl font-extrabold text-gray-900 mt-1">
            {userBids.filter((b) => b.status === 'OUTBID').length} Lots
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-500 font-mono text-sm">Loading user bids from PostgreSQL...</div>
      ) : (
        <DataTable columns={columns} data={userBids} emptyMessage="You haven't placed any bids yet" />
      )}
    </div>
  );
}
