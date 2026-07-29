import { API_BASE } from './constants';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const token = localStorage.getItem('artmart_jwt_token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    console.warn(`[API] ${options.method || 'GET'} ${path} failed:`, err.message);
    throw err;
  }
}

export function getAllAuctions() {
  return request('/api/auctions');
}

export function getAuction(auctionId) {
  return request(`/api/auctions/${encodeURIComponent(auctionId)}`);
}

export function seedAuction({ auctionId, title, startPrice, startTime, endTime, category, images, description }) {
  return request('/api/auctions/seed', {
    method: 'POST',
    body: JSON.stringify({ auctionId, title, startPrice, startTime, endTime, category, images, description }),
  });
}

export function getAuctionHistory(auctionId, userId) {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return request(`/api/auctions/${encodeURIComponent(auctionId)}/history${params}`);
}

export function getUserBidsApi(userId) {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return request(`/api/bids/me${params}`);
}

export function recoverAuction(auctionId) {
  return request(`/api/auctions/${encodeURIComponent(auctionId)}/recover`, {
    method: 'POST',
  });
}

export function loginApi(email, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function registerApi(name, email, password) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export function googleLoginApi() {
  return request('/api/auth/google', {
    method: 'POST',
  });
}

export function getMeApi(token) {
  return request('/api/auth/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export function getTopSellers() {
  return request('/api/sellers/top');
}

export function getCategories() {
  return request('/api/categories');
}

export async function uploadImages(files) {
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('images', files[i]);
  }

  const token = localStorage.getItem('artmart_jwt_token');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    throw new Error('Failed to upload images');
  }
  return res.json();
}
