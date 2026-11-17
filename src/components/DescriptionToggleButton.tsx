// One bold ringed arrow for both directions of the description drawer: ↑ while
// closed, ↓ while open. Shared by the card and the drawer header so they match.
export default function DescriptionToggleButton({
  open,
  onClick
}: {
  open: boolean;
  onClick: () => void;
}) {
  if (open) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Collapse description"
        aria-expanded={true}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text)] transition hover:opacity-80"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="More about this property"
      aria-expanded={false}
      className="inline-flex items-center rounded-full border border-white/20 bg-black/60 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/80 shadow-md"
    >
      Details
    </button>
  );
}
