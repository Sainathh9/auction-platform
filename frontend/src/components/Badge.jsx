const VARIANT_STYLES = {
  live: 'bg-[#1F5E45]/10 text-[#1F5E45]',
  'closing-soon': 'bg-[#D97706]/10 text-[#D97706]',
  closed: 'bg-[#6B7280]/10 text-[#6B7280]',
  winning: 'text-[#1F5E45]',
  outbid: 'text-[#B91C1C]',
  lost: 'text-[#6B7280]',
};

const VARIANT_LABELS = {
  live: 'Live',
  'closing-soon': 'Closing Soon',
  closed: 'Closed',
  winning: 'Winning',
  outbid: 'Outbid',
  lost: 'Lost',
};

export default function Badge({ variant, label }) {
  const displayLabel = label || VARIANT_LABELS[variant] || variant;
  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.closed;

  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${style}`}>
      {displayLabel}
    </span>
  );
}
