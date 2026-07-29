const VARIANT_LABELS = {
  live: 'Ongoing',
  ongoing: 'Ongoing',
  'closing-soon': 'Closing Soon',
  closed: 'Ended',
  ended: 'Ended',
  winning: 'Winning',
  outbid: 'Outbid',
  lost: 'Lost',
  won: 'Won',
};

const VARIANT_COLORS = {
  live: 'text-gray-900 font-semibold',
  ongoing: 'text-gray-900 font-semibold',
  'closing-soon': 'text-gray-900 font-semibold',
  closed: 'text-gray-400 font-normal',
  ended: 'text-gray-400 font-normal',
  winning: 'text-gray-900 font-semibold',
  outbid: 'text-gray-500 font-normal',
  lost: 'text-gray-400 font-normal',
  won: 'text-gray-900 font-bold',
};

export default function Badge({ variant, label }) {
  const displayLabel = label || VARIANT_LABELS[variant] || variant;
  const colorClass = VARIANT_COLORS[variant] || 'text-gray-700';

  return (
    <span className={`text-xs font-medium tracking-tight uppercase ${colorClass}`}>
      {displayLabel}
    </span>
  );
}
