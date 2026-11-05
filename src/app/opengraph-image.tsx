/** The Open Graph image every page shares: the product's name, its promise and how it works. */
import { ImageResponse } from "next/og";

export const alt =
  "Throughline: one roadmap for product and engineering, kept true by the work that ships.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#171717";
const MUTED = "#525252";

/**
 * Draw the share image. It has no data, so it is rendered once at build time.
 *
 * Returns:
 *   A 1200 by 630 PNG.
 */
export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#ffffff",
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="7" fill={INK} />
          <path
            d="M5 8h22M5 16h22M5 24h22"
            stroke="#fafafa"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.35"
          />
          <path
            d="M9 8l7 8 7 8"
            stroke="#fafafa"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="9" cy="8" r="3" fill="#fafafa" />
          <circle cx="16" cy="16" r="3" fill="#fafafa" />
          <circle cx="23" cy="24" r="3" fill="#fafafa" />
        </svg>
        <div style={{ fontSize: 44 }}>Throughline</div>
      </div>
      <div
        style={{
          fontSize: 68,
          lineHeight: 1.1,
          letterSpacing: -1.5,
        }}
      >
        One roadmap for product and engineering, kept true by the work that
        ships.
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          fontSize: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {["Product view", "Technical view", "Issues and pull requests"].map(
            (label, i) => (
              <div
                key={label}
                style={{ display: "flex", alignItems: "center", gap: 16 }}
              >
                {i > 0 && <div style={{ color: MUTED }}>↔</div>}
                <div
                  style={{
                    border: "2px solid #e5e5e5",
                    borderRadius: 999,
                    padding: "8px 22px",
                  }}
                >
                  {label}
                </div>
              </div>
            ),
          )}
        </div>
        <div style={{ color: MUTED }}>
          Agents propose roadmap updates. A person approves them.
        </div>
      </div>
    </div>,
    size,
  );
}
