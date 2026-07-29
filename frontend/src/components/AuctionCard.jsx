import { useNavigate } from 'react-router-dom';
import Badge from './Badge';
import CountdownTimer from './CountdownTimer';
import ImageCarousel from './ImageCarousel';

function formatCurrency(val) {
  if (val == null) return '—';
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
}

function getStatusVariant(auction) {
  if (auction.status === 'FINISHED') return 'ended';
  const remaining = auction.endTime - Date.now();
  if (remaining <= 0) return 'ended';
  if (remaining <= 60000) return 'closing-soon';
  return 'ongoing';
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AuctionCard({ auction }) {
  const navigate = useNavigate();
  const isFinished = auction.status === 'FINISHED' || auction.endTime <= Date.now();

  return (
    <div
      onClick={() => navigate(`/auction/${auction.id}`)}
      className="group bg-white border border-gray-200 hover:border-gray-900 transition-all duration-200 cursor-pointer flex flex-col justify-between overflow-hidden shadow-xs hover:shadow-md rounded-xl"
    >
      <div>
        {/* Card Image Header */}
        <div className="relative aspect-4/3 bg-gray-50 overflow-hidden">
          <ImageCarousel
            images={auction.images}
            name={auction.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded">
            <Badge variant={getStatusVariant(auction)} />
          </div>
          <div className="absolute top-3 right-3 z-10 bg-gray-900/90 text-white px-2.5 py-1 text-[11px] font-medium rounded">
            {auction.category}
          </div>
        </div>

        {/* Card Content */}
        <div className="p-4">
          <div className="text-[11px] text-gray-500 mb-1 font-medium">{auction.id}</div>
          <h3 className="font-bold text-sm text-gray-900 group-hover:text-black transition-colors line-clamp-1 mb-3">
            {auction.title}
          </h3>

          <div className="grid grid-cols-2 gap-2 py-2.5 border-y border-gray-100 text-xs">
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Current Bid</div>
              <div className="font-bold text-base text-gray-900 mt-0.5">
                {formatCurrency(auction.currentHighestBid)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Time Remaining</div>
              <div className="mt-1 font-semibold">
                {isFinished ? (
                  <span className="text-xs text-gray-500">Ended</span>
                ) : (
                  <CountdownTimer expiresAt={auction.endTime} compact />
                )}
              </div>
              <div className="text-[10px] text-gray-500 font-normal mt-1 flex flex-col items-end gap-0.5">
                {auction.startTime && <span>Started: {formatDate(auction.startTime)}</span>}
                <span>{isFinished ? `Ended: ${formatDate(auction.endTime)}` : `Ends: ${formatDate(auction.endTime)}`}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card Footer */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs font-medium">
        <span className="text-gray-500">{auction.bidCount} Bids Placed</span>
        <span className="font-bold text-gray-900 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
          {isFinished ? 'View Details' : 'Place Bid'} →
        </span>
      </div>
    </div>
  );
}
