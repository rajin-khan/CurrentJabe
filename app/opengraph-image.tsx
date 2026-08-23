import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Current Jabe Kokhon? · CurrentJabe";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const fontRegular = await readFile(join(process.cwd(), "app/fonts/noto-sans-bengali-400.ttf"));
  const fontBold = await readFile(join(process.cwd(), "app/fonts/noto-sans-bengali-700.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          color: "#171713",
          background: "#f5f0e7",
          fontFamily: "Noto",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 790,
            padding: "58px 62px",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 700 }}>
            <div
              style={{
                display: "flex",
                width: 50,
                height: 50,
                alignItems: "center",
                justifyContent: "center",
                color: "#fffaf2",
                borderRadius: 14,
                background: "#e34232",
                fontSize: 29,
              }}
            >
              ϟ
            </div>
            <span>Current<span style={{ color: "#e34232" }}>Jabe</span></span>
          </div>

          <div style={{ display: "flex", maxWidth: 660, flexDirection: "column" }}>
            <div style={{ display: "flex", color: "#6d675e", fontSize: 18, fontWeight: 700 }}>
              Bangladesh community outage map
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 18,
                flexDirection: "column",
                fontSize: 78,
                fontWeight: 700,
                letterSpacing: -5,
                lineHeight: 0.94,
              }}
            >
              <div style={{ display: "flex" }}>
                <span>Current&nbsp;</span>
                <span style={{ color: "#e34232" }}>Jabe</span>
              </div>
              <span>Kokhon?</span>
            </div>
          </div>

          <div style={{ display: "flex", color: "#6d675e", fontSize: 22 }}>
            Live reports and likely outage windows for your area.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: 410,
            padding: "58px 50px",
            flexDirection: "column",
            justifyContent: "space-between",
            color: "#171713",
            background: "#e34232",
          }}
        >
          <span style={{ display: "flex", fontSize: 18, fontWeight: 700 }}>LIVE MAP</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ display: "flex", fontSize: 92, fontWeight: 700, letterSpacing: -6, lineHeight: 0.9 }}>64</span>
            <span style={{ display: "flex", marginTop: 14, fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>
              districts on one shared map
            </span>
          </div>
          <span style={{ display: "flex", fontSize: 18, fontWeight: 500 }}>Anonymous community reports</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Noto", data: fontRegular, weight: 400 },
        { name: "Noto", data: fontBold, weight: 700 },
      ],
    },
  );
}
