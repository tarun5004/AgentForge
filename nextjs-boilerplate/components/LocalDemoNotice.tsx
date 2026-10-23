// A server-rendered label keeps recordings honest without adding client state or provider credentials.
export function LocalDemoNotice() {
  return (
    <aside aria-label="Local fixture demo" className="border-b border-amber-400/30 bg-[#292213] px-4 py-2 text-center text-xs leading-5 text-amber-100">
      <strong>Fixture AI · local demo</strong> — No live model calls in this launcher.
      {" "}Auth, storage and Docker are real. Demo data is cleared on normal exit.
    </aside>
  );
}
