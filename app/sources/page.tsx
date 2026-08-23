import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { MAP_ATTRIBUTION } from "@/lib/geo-map";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Map Data & Electricity Sources",
  description:
    "Review the Bangladesh administrative-boundary, locality and official electricity-provider sources used by CurrentJabe.",
  path: "/sources",
});

export default function SourcesPage() {
  return (
    <LegalShell title="Sources">
      <h2>Administrative geography</h2>
      <p>
        The interactive map uses public Bangladesh administrative-boundary information processed
        into simplified, code-native SVG geometry. Boundary data is orientation—not a claim that
        an administrative border is an electricity feeder boundary.
      </p>
      <p>
        {MAP_ATTRIBUTION} The geometry is pinned to a specific upstream revision so future source
        changes cannot silently redraw the live map.
      </p>
      <p>
        Review the public source project at{" "}
        <a href="https://www.geoboundaries.org/" rel="noreferrer" target="_blank">
          geoBoundaries
        </a>{" "}
        and the official geographic-code reference at{" "}
        <a href="https://bbs.gov.bd/" rel="noreferrer" target="_blank">
          Bangladesh Bureau of Statistics
        </a>
        .
      </p>

      <h2>Locality and feeder precision</h2>
      <p>
        The starter list of Dhaka-specific reporting areas is hand-transcribed from public place
        names, not copied map geometry. Bangladesh Bureau of Statistics reports anchor the formal
        thana hierarchy; DNCC&apos;s ward-area list supports Mirpur section names, and DSCC&apos;s ward
        roster supports the bundled Dhanmondi road names.
      </p>
      <p>
        Review the{" "}
        <a
          href="https://nsds.bbs.gov.bd/storage/files/1/Publications/PHC_2021%20Community%20Report/DHAKA%20DIVISION/Community%20Report%20Dhaka.pdf"
          rel="noreferrer"
          target="_blank"
        >
          BBS Dhaka Community Report
        </a>
        , the{" "}
        <a
          href="https://dncc.gov.bd/pages/static-pages/6922ded3933eb65569e1da8e"
          rel="noreferrer"
          target="_blank"
        >
          DNCC ward-area list
        </a>{" "}
        and the{" "}
        <a
          href="https://dscc.gov.bd/site/page/968ca790-6f0f-4efe-90a0-69b5c650b533/%E0%A6%93%E0%A7%9F%E0%A6%BE%E0%A6%B0%E0%A7%8D%E0%A6%A1%E0%A6%AD%E0%A6%BF%E0%A6%A4%E0%A7%8D%E0%A6%A4%E0%A6%BF%E0%A6%95-%E0%A6%AA%E0%A6%B0%E0%A6%BF%E0%A6%9A%E0%A7%8D%E0%A6%9B%E0%A6%A8%E0%A7%8D%E0%A6%A8%E0%A6%95%E0%A6%B0%E0%A7%8D%E0%A6%AE%E0%A7%80%E0%A6%B0-%E0%A6%A4%E0%A6%BE%E0%A6%B2%E0%A6%BF%E0%A6%95%E0%A6%BE"
          rel="noreferrer"
          target="_blank"
        >
          DSCC ward roster
        </a>
        .
      </p>
      <p>
        Mirpur DOHS is available as a finer community reporting area because a DESCO project
        study published by the Asian Development Bank names its DOHS-1 and DOHS-2 distribution
        routes. Its map selection highlights the Pallabi and Turag administrative features only as
        an approximation—not as a locality boundary, service territory or feeder polygon.
      </p>
      <p>
        Review the{" "}
        <a
          href="https://www.adb.org/projects/documents/ban-55040-001-iee"
          rel="noreferrer"
          target="_blank"
        >
          ADB-hosted DESCO project study
        </a>
        . Utility documents also show that interruption operations can occur at feeder or breaker
        scope; see DESCO&apos;s{" "}
        <a
          href="https://desco.gov.bd/pages/sps-datas/%E0%A6%A2%E0%A6%BE%E0%A6%95%E0%A6%BE-%E0%A6%87%E0%A6%B2%E0%A7%87%E0%A6%95%E0%A6%9F%E0%A7%8D%E0%A6%B0%E0%A6%BF%E0%A6%95-%E0%A6%B8%E0%A6%BE%E0%A6%AA%E0%A7%8D%E0%A6%B2%E0%A6%BE%E0%A6%87-%E0%A6%95%E0%A7%8B%E0%A6%AE%E0%A7%8D%E0%A6%AA%E0%A6%BE%E0%A6%A8%E0%A6%BF-%E0%A6%A1%E0%A7%87%E0%A6%B8%E0%A6%95%E0%A7%8B-%E0%A6%B2%E0%A6%BF%E0%A6%AE%E0%A6%BF%E0%A6%9F%E0%A7%87%E0%A6%A1-%E0%A6%8F%E0%A6%B0-%E0%A6%89%E0%A6%A4%E0%A7%8D%E0%A6%A4%E0%A6%AE-%E0%A6%9A%E0%A6%B0%E0%A7%8D%E0%A6%9A%E0%A6%BE%E0%A6%B0-2b4b93-6922daf081fc96cef9eb7ef5"
          rel="noreferrer"
          target="_blank"
        >
          service-practice page
        </a>{" "}
        and DPDC&apos;s{" "}
        <a
          href="https://dpdc.org.bd/notice/other/DASMS%20TD%2008.02.17%20Final.pdf"
          rel="noreferrer"
          target="_blank"
        >
          monitoring specification
        </a>
        . No nationwide public consumer-to-feeder boundary dataset is bundled, so CurrentJabe
        does not infer a feeder name from a neighborhood.
      </p>
      <p>
        People can add a missing specific-area name. The server normalizes spelling and formatting,
        reuses exact matches inside the selected parent, and makes a genuinely new name available
        immediately. A community-added name is a reporting label only: it is not an officially
        verified neighborhood, administrative border, provider territory or feeder boundary.
      </p>

      <h2>Electricity providers</h2>
      <p>
        Provider hints are assembled only from official public information published by the{" "}
        <a href="https://bpdb.gov.bd/" rel="noreferrer" target="_blank">Bangladesh Power Development Board</a>,{" "}
        <a href="https://reb.gov.bd/" rel="noreferrer" target="_blank">Bangladesh Rural Electrification Board</a>,{" "}
        <a href="https://dpdc.org.bd/" rel="noreferrer" target="_blank">DPDC</a>,{" "}
        <a href="https://desco.gov.bd/" rel="noreferrer" target="_blank">DESCO</a>,{" "}
        <a href="https://wzpdcl.gov.bd/" rel="noreferrer" target="_blank">WZPDCL</a> and{" "}
        <a href="https://nesco.gov.bd/" rel="noreferrer" target="_blank">NESCO</a>. An upazila may
        contain more than one provider, so hints remain optional and can be marked unknown.
      </p>

      <h2>Official links, community forecast</h2>
      <p>
        Where stable official sources exist, area pages may link to them. CurrentJabe does not
        automatically treat fragmented schedules as ground truth, imply provider affiliation, or
        blend official notices invisibly into community forecasts.
      </p>

      <h2>Corrections</h2>
      <p>
        Administrative names and provider service territories change. Corrections can be reviewed
        through the private operator tools without rewriting historical community observations.
      </p>
    </LegalShell>
  );
}
