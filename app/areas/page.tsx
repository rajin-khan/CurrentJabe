import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { locations, type LocationRecord } from "@/lib/locations";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Bangladesh Electricity Status by Area",
  description:
    "Browse CurrentJabe electricity status and community outage predictions by district, upazila, thana and supported local area in Bangladesh.",
  path: "/areas",
});

function groupByDistrict(records: readonly LocationRecord[]) {
  const grouped = new Map<string, LocationRecord[]>();
  for (const location of records) {
    const districtLocations = grouped.get(location.district) ?? [];
    districtLocations.push(location);
    grouped.set(location.district, districtLocations);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([district, districtLocations]) => ({
      district,
      locations: districtLocations.sort((left, right) =>
        left.upazila.localeCompare(right.upazila, "en"),
      ),
    }));
}

const districts = groupByDistrict(locations);

export default function AreasPage() {
  return (
    <main>
      <SiteHeader />
      <section className="area-directory">
        <header className="area-directory__intro">
          <p className="eyebrow">Nationwide community coverage</p>
          <h1>Electricity status by area.</h1>
          <p>
            Browse Bangladesh by district, then open an area to see its live community signal,
            reporting progress and likely outage windows.
          </p>
        </header>

        <div className="area-directory__districts">
          {districts.map(({ district, locations: districtLocations }) => (
            <section className="area-directory__district" key={district}>
              <header>
                <h2>{district}</h2>
                <span>{districtLocations.length} areas</span>
              </header>
              <ul>
                {districtLocations.map((location) => (
                  <li key={location.id}>
                    <Link href={`/area/${location.slug}`}>
                      <span>{location.upazila}</span>
                      {location.upazilaBn ? <small lang="bn">{location.upazilaBn}</small> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
