import { useNavigate } from 'react-router-dom';
import Badge from './Badge';
import CountdownTimer from './CountdownTimer';
import PlaceholderImage from './PlaceholderImage';

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

export default function AuctionCard({ auction }) {
  const navigate = useNavigate();
  const isFinished = auction.status === 'FINISHED' || auction.endTime <= Date.now();

  return (
    <div
      onClick={() => navigate(`/auction/${auction.id}`)}
      className="group bg-white border border-[#E2E4E9] hover:border-[#1A2B4C] transition-all duration-200 cursor-pointer flex flex-col justify-between overflow-hidden shadow-xs hover:shadow-md"
    >
      <div>
        {/* Card Image Header */}
        <div className="relative aspect-4/3 bg-[#F7F8FA] overflow-hidden">
          <PlaceholderImage
            src={auction.image}
            name={auction.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute top-3 left-3 z-10">
            <Badge variant={getStatusVariant(auction)} />
          </div>
          <div className="absolute top-3 right-3 z-10 bg-[#12151C]/80 backdrop-blur-xs text-white px-2 py-1 text-[11px] font-mono rounded-xs">
            {auction.category}
          </div>
        </div>

        {/* Card Content */}
        <div className="p-4">
          <div className="text-[11px] font-mono text-[#6B7280] mb-1 tracking-tight">{auction.id}</div>
          <h3 className="font-semibold text-sm text-[#12151C] group-hover:text-[#1A2B4C] transition-colors line-clamp-1 mb-3">
            {auction.title}
          </h3>

          <div className="grid grid-cols-2 gap-2 py-2 border-y border-[#E2E4E9]/60 text-xs">
            <div>
              <div className="text-[11px] text-[#6B7280] uppercase tracking-wider">Current Bid</div>
              <div className="font-mono font-bold text-base text-[#1A2B4C] mt-0.5">
                {formatCurrency(auction.currentHighestBid)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#6B7280] uppercase tracking-wider">Time Left</div>
              <div className="mt-1">
                {isFinished ? (
                  <span className="font-mono text-xs text-[#6B7280]">Ended</span>
                ) : (
                  <CountdownTimer expiresAt={auction.endTime} compact />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card Footer */}
      <div className="px-4 py-3 bg-[#F7F8FA] border-t border-[#E2E4E9] flex items-center justify-between text-xs">
        <span className="text-[#6B7280] font-mono">{auction.bidCount} bids</span>
        <span className="font-medium text-[#1A2B4C] group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
          {isFinished ? 'View Details' : 'Place Bid'} →
        </span>
      </div>
    </div>
  );
}
