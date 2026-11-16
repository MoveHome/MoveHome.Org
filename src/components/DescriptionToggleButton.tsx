// One bold ringed arrow for both directions of the description drawer: ↑ while
// closed, ↓ while open. Shared by the card and the drawer header so they match.
export default function DescriptionToggleButton({
  open,
  onClick
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? 'Collapse description' : 'More about this property'}
      aria-expanded={open}
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-2 border-orange-500 bg-zinc-900 text-white shadow-[0_0_0_4px_rgba(249,115,22,0.25)] transition-transform hover:scale-105"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {open ? (
          <>
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="5 12 12 19 19 12" />
          </>
        ) : (
          <>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </>
        )}
      </svg>
    </button>
  );
}
