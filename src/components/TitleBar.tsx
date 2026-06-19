import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

function handleDragStart(e: React.MouseEvent) {
  if (e.button === 0) win.startDragging();
}

export default function TitleBar() {
  return (
    <div
      onMouseDown={handleDragStart}
      style={{
        height: 38,
        flexShrink: 0,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 10px 0 20px",
        cursor: "default",
      }}
    >
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        color: "var(--t3)",
        pointerEvents: "none",
      }}>
        REIYA ACCOUNT MANAGER
      </span>

      {/* Stop propagation so clicks on buttons don't start dragging */}
      <div
        style={{ display: "flex", gap: 4 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <WinBtn onClick={() => win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="5" x2="9" y2="5" />
          </svg>
        </WinBtn>
        <WinBtn onClick={() => win.toggleMaximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1.5" y="1.5" width="7" height="7" />
          </svg>
        </WinBtn>
        <WinBtn onClick={() => win.close()} danger>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </WinBtn>
      </div>
    </div>
  );
}

function WinBtn({ onClick, danger, children }: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={e => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = danger ? "var(--red)" : "var(--surface-3)";
        b.style.color = "var(--t1)";
      }}
      onMouseLeave={e => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = "transparent";
        b.style.color = "var(--t3)";
      }}
      style={{
        width: 28, height: 28,
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "var(--t3)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .1s, color .1s",
      }}
    >
      {children}
    </button>
  );
}

