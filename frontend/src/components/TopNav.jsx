import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Auctions' },
  { to: '/my-bids', label: 'My Bids' },
  { to: '/admin', label: 'Admin Terminal' },
];

export default function TopNav({ isConnected }) {
  return (
    <header className="bg-[#212529] text-white shadow-xs sticky top-0 z-50">
      <nav className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
        {/* Left: Brand + Nav Links */}
        <div className="flex items-center gap-8">
          <NavLink to="/" className="flex items-center gap-2 text-white no-underline font-bold text-lg tracking-tight">
            <span className="bg-[#0d6efd] text-white w-7 h-7 rounded flex items-center justify-center text-xs font-extrabold">
              B
            </span>
            <span>BidEngine</span>
          </NavLink>

          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 text-sm font-medium no-underline rounded transition-colors ${
                    isActive
                      ? 'text-white font-semibold bg-white/10'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>

        {/* Right: Status Badge + Create Button */}
        <div className="flex items-center gap-3">
          <span
            className={`px-2.5 py-1 text-xs rounded-full font-medium inline-flex items-center gap-1.5 ${
              isConnected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
            <span>{isConnected ? 'Live WebSocket' : 'Offline / Mock'}</span>
          </span>

          <NavLink
            to="/admin"
            className="bg-[#0d6efd] hover:bg-[#0b5ed7] text-white text-xs font-medium px-3.5 py-1.5 rounded transition-colors no-underline shadow-xs"
          >
            + Create Lot
          </NavLink>
        </div>
      </nav>
    </header>
  );
}
