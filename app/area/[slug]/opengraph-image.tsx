import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { resolvePublicLocation } from "@/lib/server/localities";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = { params: Promise<{ slug: string }> };

export async function generateImageMetadata({ params }: { params: { slug: string } }) {
  const location = await resolvePublicLocation(params.slug).catch(() => null);
  const area = location?.upazila ?? "CurrentJabe area";
  const district = location?.district ?? "Bangladesh";

  return [
    {
      id: "default",
      alt: `${area}, ${district} community electricity status and prediction`,
      size,
      contentType,
    },
  ];
}

export default async function OpenGraphImage({ params }: Props) {
  const { slug } = await params;
  const location = await resolvePublicLocation(slug).catch(() => null);
  const fontRegular = await readFile(join(process.cwd(), "app/fonts/satoshi-400.ttf"));
  const fontMedium = await readFile(join(process.cwd(), "app/fonts/satoshi-500.ttf"));
  const fontBold = await readFile(join(process.cwd(), "app/fonts/satoshi-700.ttf"));
  const bengaliRegular = await readFile(
    join(process.cwd(), "app/fonts/noto-sans-bengali-400.ttf"),
  );
  const bengaliMedium = await readFile(
    join(process.cwd(), "app/fonts/noto-sans-bengali-500.ttf"),
  );
  const bengaliBold = await readFile(
    join(process.cwd(), "app/fonts/noto-sans-bengali-700.ttf"),
  );
  const mark = await readFile(join(process.cwd(), "public/brand/currentjabe-mark-v3.png"));
  const markUrl = `data:image/png;base64,${mark.toString("base64")}`;
  const area = location?.upazila ?? "Your area";
  const district = location?.district ?? "Bangladesh";
  const areaSize = area.length > 26 ? 66 : area.length > 18 ? 78 : 96;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          color: "#171714",
          background: "#f4efe6",
          fontFamily: "Satoshi, Noto Sans Bengali",
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
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 700, letterSpacing: -1.2 }}>
            <img alt="" src={markUrl} style={{ height: 48, width: 48 }} />
            <span>Current<span style={{ color: "#e34232" }}>Jabe</span></span>
          </div>

          <div style={{ display: "flex", maxWidth: 650, flexDirection: "column" }}>
            <span style={{ display: "flex", color: "#69645c", fontSize: 17, fontWeight: 700, letterSpacing: 2.1, textTransform: "uppercase" }}>
              Power status and prediction for
            </span>
            <span
              style={{
                display: "flex",
                marginTop: 17,
                fontSize: areaSize,
                fontWeight: 500,
                letterSpacing: -5.5,
                lineHeight: 0.9,
              }}
            >
              {area}
            </span>
            <span style={{ display: "flex", marginTop: 18, color: "#69645c", fontSize: 28 }}>
              {district}, Bangladesh
            </span>
          </div>

          <span style={{ display: "flex", color: "#69645c", fontSize: 18 }}>
            Live reports · outage history · likely windows
          </span>
        </div>

        <div
          style={{
            display: "flex",
            width: 410,
            padding: "58px 50px",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#fffaf2",
            background: "#0e0e0c",
          }}
        >
          <span style={{ display: "flex", alignSelf: "stretch", color: "rgba(255,250,242,.6)", fontSize: 16, fontWeight: 700, letterSpacing: 2.1 }}>
            COMMUNITY AREA
          </span>
          <img alt="" src={markUrl} style={{ height: 230, width: 230 }} />
          <div style={{ display: "flex", alignSelf: "stretch", flexDirection: "column" }}>
            <span style={{ display: "flex", color: "#e34232", fontSize: 22, fontWeight: 700 }}>
              Current Jabe Kokhon?
            </span>
            <span style={{ display: "flex", marginTop: 8, color: "rgba(255,250,242,.58)", fontSize: 15 }}>
              Community estimate · not an official schedule
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Satoshi", data: fontRegular, weight: 400 },
        { name: "Satoshi", data: fontMedium, weight: 500 },
        { name: "Satoshi", data: fontBold, weight: 700 },
        { name: "Noto Sans Bengali", data: bengaliRegular, weight: 400 },
        { name: "Noto Sans Bengali", data: bengaliMedium, weight: 500 },
        { name: "Noto Sans Bengali", data: bengaliBold, weight: 700 },
      ],
    },
  );
}
