import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getLocationBySlug } from "@/lib/locations";

export const alt = "CurrentJabe community electricity area card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = { params: Promise<{ slug: string }> };

export default async function OpenGraphImage({ params }: Props) {
  const { slug } = await params;
  const location = getLocationBySlug(slug);
  const fontRegular = await readFile(join(process.cwd(), "app/fonts/noto-sans-bengali-400.ttf"));
  const fontBold = await readFile(join(process.cwd(), "app/fonts/noto-sans-bengali-700.ttf"));
  const area = location?.upazila ?? "Your area";
  const district = location?.district ?? "Bangladesh";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: 62,
          flexDirection: "column",
          justifyContent: "space-between",
          color: "#fffaf2",
          background: "#11110f",
          fontFamily: "Noto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 700 }}>
          <div style={{ display: "flex", width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 15, color: "#fffaf2", background: "#e34232", fontSize: 30 }}>ϟ</div>
          <span>Current<span style={{ color: "#e34232" }}>Jabe</span></span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ display: "flex", color: "#e34232", fontSize: 24, fontWeight: 700 }}>
            Power status and prediction for
          </span>
          <span style={{ display: "flex", marginTop: 14, fontSize: area.length > 20 ? 82 : 108, lineHeight: 0.92, letterSpacing: -7, fontWeight: 700 }}>{area}</span>
          <span style={{ display: "flex", marginTop: 16, color: "rgba(255,255,255,.62)", fontSize: 30 }}>{district}, Bangladesh</span>
        </div>
        <span style={{ display: "flex", color: "rgba(255,255,255,.58)", fontSize: 21 }}>
          Live community reports and likely outage windows
        </span>
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
