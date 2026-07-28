import { Link } from 'react-router-dom';
import { getMockUserBids, MOCK_AUCTIONS } from '../lib/mockData';
import DataTable from '../components/DataTable';
import Badge from '../components/Badge';
import PlaceholderImage from '../components/PlaceholderImage';

function formatCurrency(val) {
  if (val == null) return '—';
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusToVariant(status) {
  if (status === 'WINNING') return 'winning';
  if (status === 'OUTBID') return 'outbid';
  return 'lost';
}

export default function MyBids() {
  const userBids = getMockUserBids();

  // Compute summary stats
  const winningBids = userBids.filter((b) => b.status === 'WINNING');
  const totalCommitted = winningBids.reduce((sum, b) => sum + b.amount, 0);

  const columns = [
    {
      key: 'auctionTitle',
      label: 'Auction Lot',
      sortable: true,
      render: (val, row) => {
        const item = MOCK_AUCTIONS.find((a) => a.id === row.auctionId);
        return (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 flex-shrink-0 overflow-hidden border border-slate-200">
              <PlaceholderImage src={item?.image} name={val} size={40} className="w-full h-full object-cover" />
            </div>
            <div>
              <Link to={`/auction/${row.auctionId}`} className="font-semibold text-[#1A2B4C] hover:underline no-underline text-sm block">
                {val}
              </Link>
              <div className="text-[11px] font-mono text-[#6B7280]">{row.auctionId}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'amount',
      label: 'My Bid Amount',
      sortable: true,
      mono: true,
      align: 'right',
      render: (val) => <span className="font-bold text-[#12151C]">{formatCurrency(val)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (val) => <Badge variant={statusToVariant(val)} />,
    },
    {
      key: 'timestamp',
      label: 'Placed At',
      sortable: true,
      mono: true,
      render: (val) => <span className="text-xs text-[#6B7280]">{formatTimestamp(val)}</span>,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#12151C]">My Bidding Activity</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">Real-time audit log of your active and past bids</p>
        </div>
        <div className="text-xs text-[#6B7280] font-mono">
          TOTAL BIDS: <strong className="text-[#12151C]">{userBids.length}</strong>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border border-[#E2E4E9] bg-white p-4 shadow-xs">
          <div className="text-[11px] font-mono text-[#6B7280] uppercase">Currently Winning</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">{winningBids.length} Lots</div>
        </div>
        <div className="border border-[#E2E4E9] bg-white p-4 shadow-xs">
          <div className="text-[11px] font-mono text-[#6B7280] uppercase">Active Capital Committed</div>
          <div className="text-2xl font-bold font-mono text-[#1A2B4C] mt-1">{formatCurrency(totalCommitted)}</div>
        </div>
        <div className="border border-[#E2E4E9] bg-white p-4 shadow-xs">
          <div className="text-[11px] font-mono text-[#6B7280] uppercase">Outbid Alerts</div>
          <div className="text-2xl font-bold font-mono text-amber-600 mt-1">
            {userBids.filter((b) => b.status === 'OUTBID').length} Lots
          </div>
        </div>
      </div>

      <DataTable columns={columns} data={userBids} emptyMessage="You haven't placed any bids yet" />
    </div>
  );
}
