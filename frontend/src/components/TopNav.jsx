import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { getTopSellers, getCategories } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function TopNav({ isConnected }) {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showSellerMenu, setShowSellerMenu] = useState(false);
  const [topSellers, setTopSellers] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    Promise.all([getTopSellers(), getCategories()])
      .then(([sellers, cats]) => {
        if (Array.isArray(sellers)) setTopSellers(sellers);
        if (Array.isArray(cats)) setCategories(cats);
      })
      .catch(err => console.error("Failed to load TopNav data", err));
  }, []);

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50 text-gray-900 font-sans shadow-xs">
      {/* Top Header Row: Logo | Center Search Bar | Language, Wishlist, My Account */}
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-6 border-b border-gray-100">
        {/* Brand Logo */}
        <NavLink to="/" className="text-2xl font-serif font-bold text-gray-900 tracking-tight no-underline flex items-center gap-2">
          <span>OutBid</span>
          <span className="text-[11px] font-sans font-bold text-gray-900 bg-gray-100 px-2 py-0.5 uppercase tracking-wider rounded">
            AUCTION
          </span>
        </NavLink>

        {/* Center Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex-1 max-w-xl relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your product here..."
            className="w-full bg-gray-50 border border-gray-200 rounded-full px-5 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-gray-900 focus:bg-white transition-all placeholder:text-gray-400"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 text-base cursor-pointer px-2 py-1"
          >
            🔍
          </button>
        </form>

        {/* Right Action Icons: Language | Wishlist | My Account Button */}
        <div className="flex items-center gap-5 text-sm text-gray-700">
          <NavLink
            to="/login"
            className="bg-gray-900 hover:bg-black text-white text-sm font-bold px-5 py-2.5 rounded-full transition-colors no-underline flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <span>👤</span>
            <span>{isAuthenticated ? user.name : 'My Account'}</span>
          </NavLink>
        </div>
      </div>

      {/* Main Navigation Menu Bar */}
      <nav className="max-w-[1400px] mx-auto px-6 h-13 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-gray-700">
        <div className="flex items-center gap-8">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `no-underline transition-colors py-3.5 ${isActive ? 'text-black font-bold border-b-2 border-black' : 'text-gray-600 hover:text-black'}`
            }
          >
            Home
          </NavLink>

          {/* Top Rated Sellers */}
          <div
            className="relative cursor-pointer py-3.5 text-gray-600 hover:text-black flex items-center gap-1"
            onMouseEnter={() => setShowSellerMenu(true)}
            onMouseLeave={() => setShowSellerMenu(false)}
          >
            <span>Top Rated Sellers ▾</span>
            {showSellerMenu && (
              <div className="absolute top-full left-0 w-64 bg-white border border-gray-200 shadow-lg py-2 normal-case font-normal text-sm z-50 rounded-b-md">
                {topSellers.map((seller) => (
                  <div key={seller.id} className="px-4 py-3 hover:bg-gray-50 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{seller.name}</div>
                      <div className="text-xs text-gray-500">{seller.sales}</div>
                    </div>
                    <span className="text-gray-900 font-bold">★ {seller.rating}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Categories */}
          <div
            className="relative cursor-pointer py-3.5 text-gray-600 hover:text-black flex items-center gap-1"
            onMouseEnter={() => setShowCategoryMenu(true)}
            onMouseLeave={() => setShowCategoryMenu(false)}
          >
            <span>Categories ▾</span>
            {showCategoryMenu && (
              <div className="absolute top-full left-0 w-56 bg-white border border-gray-200 shadow-lg py-2 normal-case font-normal text-sm z-50 rounded-b-md">
                {categories.map((cat) => (
                  <NavLink
                    key={cat}
                    to={`/?cat=${encodeURIComponent(cat)}`}
                    className="block px-4 py-2.5 text-gray-700 hover:bg-gray-50 hover:text-gray-900 no-underline"
                  >
                    {cat}
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          {/* My Bids */}
          <NavLink
            to="/my-bids"
            className={({ isActive }) =>
              `no-underline transition-colors py-3.5 ${isActive ? 'text-black font-bold border-b-2 border-black' : 'text-gray-600 hover:text-black'}`
            }
          >
            My Bids
          </NavLink>

          {/* Admin Terminal */}
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `no-underline transition-colors py-3.5 ${isActive ? 'text-black font-bold border-b-2 border-black' : 'text-gray-600 hover:text-black'}`
            }
          >
            Admin Terminal
          </NavLink>
        </div>


      </nav>
    </header>
  );
}
