import { useState } from 'react';

export default function PlaceholderImage({ src, name = '', size, className = '' }) {
  const [error, setError] = useState(false);

  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (src && !error) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setError(true)}
        className={`object-cover ${className}`}
        style={size ? { width: typeof size === 'number' ? `${size}px` : size, height: typeof size === 'number' ? `${size}px` : size } : undefined}
      />
    );
  }

  return (
    <div
      className={`bg-[#E2E4E9] flex items-center justify-center font-mono font-bold text-[#6B7280] select-none ${className}`}
      style={size ? { width: typeof size === 'number' ? `${size}px` : size, height: typeof size === 'number' ? `${size}px` : size } : undefined}
    >
      <span className="text-xl tracking-wider">{initials || '?'}</span>
    </div>
  );
}
