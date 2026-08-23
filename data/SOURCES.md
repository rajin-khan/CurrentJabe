# CurrentJabe geographic data sources

This directory contains a compact, application-specific derivative dataset. It
does not call a map API at runtime and does not use paid tiles.

## Administrative geometry

- **Dataset:** geoBoundaries `gbOpen` Bangladesh ADM2 and ADM3
- **Boundary ID:** `BGD-ADM2-16705992` and `BGD-ADM3-5055444`
- **Pinned source revision:** `wmgeolab/geoBoundaries@9469f09`
- **Represented year:** 2020
- **Primary sources named in the metadata:** Bangladesh Bureau of Statistics
  (BBS), OCHA ROAP
- **License named in the file metadata:** Creative Commons Attribution 3.0
  Intergovernmental Organisations (CC BY 3.0 IGO)
- **Metadata:**
  - <https://www.geoboundaries.org/api/current/gbOpen/BGD/ADM2/>
  - <https://www.geoboundaries.org/api/current/gbOpen/BGD/ADM3/>
- **Pinned simplified inputs:**
  - <https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BGD/ADM2/geoBoundaries-BGD-ADM2_simplified.geojson>
  - <https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BGD/ADM3/geoBoundaries-BGD-ADM3_simplified.geojson>

Required map attribution:

> Administrative boundaries: Bangladesh Bureau of Statistics (BBS) and OCHA
> ROAP, distributed via geoBoundaries; CC BY 3.0 IGO.

`map-paths.json` is a derivative: the coordinates are projected into a shared
`0 0 720 960` SVG viewBox, rounded, and simplified at roughly 0.32 SVG pixels.
Polygon holes are retained; render paths with `fill-rule="evenodd"`.

## English and Bangla names

- **Dataset:** `nuhil/bangladesh-geocode`
- **Pinned revision:** `5622f68bd07a98e076edcf8100bf0db6a75b9854`
- **Files used:** `districts/districts.json`, `upazilas/upazilas.json`
- **License:** MIT
- **Repository:** <https://github.com/nuhil/bangladesh-geocode>
- **Provenance note from its author:** spellings were compiled from the
  Bangladesh National Portal, Wikipedia, and Google Maps. For that reason,
  Bangla names are best-effort display labels, not legal boundary evidence.

The Bangladesh National Portal's upazila list was used as the primary public
cross-check and to supplement Shayestaganj, bringing the searchable upazila
count to the nationally published 495:

- <https://bangladesh.gov.bd/views/upazila-list/Upazilla%20List/>
- <https://bangladesh.gov.bd/site/page/51ae2125-d2f7-430e-8558-53bf94990d0d/>

Modern public-facing names replace two obsolete names while retaining search
aliases: Shantiganj (formerly Dakshin/South Sunamganj) and Indurkani (formerly
Zianagar). Modern district spellings such as Chattogram, Cumilla, Bogura,
Jashore, and Barishal are used in the UI.

## Electricity-provider hints

Provider IDs are candidate hints only. An upazila/thana is not an electricity
feeder boundary; urban and rural networks can overlap inside one administrative
unit. An empty `providerHints` array deliberately means **unknown**.

- Power Division list of distribution entities and customer links:
  <https://powerdivision.gov.bd/pages/static-pages/6940329b35ce18e1c0561d25>
- DESCO geographic-area description (Power Division):
  <https://powerdivision.gov.bd/pages/static-pages/694032eb35ce18e1c056441d>
- DPDC service-area description:
  <https://www.dpdc.org.bd/notice/other/ToR%20for%20Consultancy%20services%20to%20tender%20and%20monitor%20the%20implementation-FI-WITH%20AUTO-UPDATE%20ATBLE-21.6.2020.pdf>
- NESCO official geographic-area table:
  <https://nesco.gov.bd/pages/static-pages/6922dc9b933eb65569e113aa>
- WZPDCL official geographic-area list:
  <https://wzpdcl.gov.bd/pages/static-pages/6922dfa1933eb65569e2322b>
- BPDB distribution-zone description:
  <https://bpdb.gov.bd/site/page/d8f6f2c3-2153-4751-b887-ec12caa5e4e9/->
- BREB overview:
  <https://reb.gov.bd/site/page/c08b56bd-c300-4d08-8ea2-c25eedffbfdb/At-a-Glance>

No nationwide upazila-to-provider or upazila-to-feeder table was inferred. Only
locations explicitly named by an official provider page, or district
headquarters in WZPDCL's official list, receive a hint. Users must still be able
to choose "I don't know" and correct the candidate.

## Finer localities and electrical scope

The initial fine-area selector uses factual place names manually transcribed
from public sources. No municipal or utility artwork is redistributed:

- The BBS Dhaka Community and District reports anchor the formal thana,
  ward, and mahalla hierarchy:
  <https://nsds.bbs.gov.bd/storage/files/1/Publications/PHC_2021%20Community%20Report/DHAKA%20DIVISION/Community%20Report%20Dhaka.pdf>
  and
  <https://nsds.bbs.gov.bd/storage/files/1/Publications/PHC_2021/Dhaka%20Division/District%20Report%20Dhaka_25062024.pdf>
- DNCC's public ward-area list supports the bundled Mirpur section names:
  <https://dncc.gov.bd/pages/static-pages/6922ded3933eb65569e1da8e>
- DSCC's ward roster explicitly names the bundled Dhanmondi road scopes:
  <https://dscc.gov.bd/site/page/968ca790-6f0f-4efe-90a0-69b5c650b533/%E0%A6%93%E0%A7%9F%E0%A6%BE%E0%A6%B0%E0%A7%8D%E0%A6%A1%E0%A6%AD%E0%A6%BF%E0%A6%A4%E0%A7%8D%E0%A6%A4%E0%A6%BF%E0%A6%95-%E0%A6%AA%E0%A6%B0%E0%A6%BF%E0%A6%9A%E0%A7%8D%E0%A6%9B%E0%A6%A8%E0%A7%8D%E0%A6%A8%E0%A6%95%E0%A6%B0%E0%A7%8D%E0%A6%AE%E0%A7%80%E0%A6%B0-%E0%A6%A4%E0%A6%BE%E0%A6%B2%E0%A6%BF%E0%A6%95%E0%A6%BE>

The first field is intentionally described as a **thana or broad area**.
Colloquial Mirpur crosses more than one formal metropolitan thana, so Mirpur
DOHS may be browsed beneath Mirpur while retaining Pallabi as its sourced
administrative parent in stored data.

`Mirpur DOHS` is the first explicitly sourced locality below the metropolitan
thana level. It is a separate community reporting and forecast bucket with
`dhaka-pallabi` as its administrative catalog parent and DESCO as a confirmed
provider:

- A DESCO project study published by the Asian Development Bank identifies
  DESCO as the executing agency and names Kalshi Grid to Mirpur DOHS-1 in
  Pallabi, Ward 02, and Kalshi Grid to Mirpur DOHS-2 through Turag/Harirampur:
  <https://www.adb.org/projects/documents/ban-55040-001-iee>
- An official ISPR publication independently uses Mirpur DOHS as a named
  locality:
  <https://ispr.gov.bd/en/chief-of-army-staff-inaugurates-112th-branch-of-the-trust-bank-at-mirpur-dohs/>

The map therefore highlights the existing Pallabi and Turag administrative
features only as **approximate visual coverage** when Mirpur DOHS is selected.
That highlight is not a Mirpur DOHS boundary, an electricity service territory,
or a feeder polygon.

Official utility documents support 11 kV feeder or breaker scope as an important
operational unit, while treating distribution transformers separately:

- DESCO's official service-practice page says customers on the relevant feeder
  are notified of pre-scheduled electricity shutdowns:
  <https://desco.gov.bd/pages/sps-datas/%E0%A6%A2%E0%A6%BE%E0%A6%95%E0%A6%BE-%E0%A6%87%E0%A6%B2%E0%A7%87%E0%A6%95%E0%A6%9F%E0%A7%8D%E0%A6%B0%E0%A6%BF%E0%A6%95-%E0%A6%B8%E0%A6%BE%E0%A6%AA%E0%A7%8D%E0%A6%B2%E0%A6%BE%E0%A6%87-%E0%A6%95%E0%A7%8B%E0%A6%AE%E0%A7%8D%E0%A6%AA%E0%A6%BE%E0%A6%A8%E0%A6%BF-%E0%A6%A1%E0%A7%87%E0%A6%B8%E0%A6%95%E0%A7%8B-%E0%A6%B2%E0%A6%BF%E0%A6%AE%E0%A6%BF%E0%A6%9F%E0%A7%87%E0%A6%A1-%E0%A6%8F%E0%A6%B0-%E0%A6%89%E0%A6%A4%E0%A7%8D%E0%A6%A4%E0%A6%AE-%E0%A6%9A%E0%A6%B0%E0%A7%8D%E0%A6%9A%E0%A6%BE%E0%A6%B0-2b4b93-6922daf081fc96cef9eb7ef5>
- DPDC's monitoring specification records load-shedding duration from breaker
  status and calls for breaker-wise and feeder-meter-wise reporting:
  <https://dpdc.org.bd/notice/other/DASMS%20TD%2008.02.17%20Final.pdf>

These sources do not publish a nationwide consumer-to-feeder boundary dataset.
CurrentJabe therefore never converts a neighborhood name into an invented
feeder. A named locality remains a community observation scope unless an exact
utility mapping is separately sourced.

Community-added area names are Unicode-normalized, safely formatted,
parent-scoped, rate-limited, and deduplicated against exact normalized matches.
They become selectable immediately but remain community reporting labels. They
inherit only an approximate parent-map highlight and never inherit an
electricity provider or feeder mapping.

## Known limitations

- The open polygon snapshot represents 2020 and contains 544 ADM3 polygons.
- It yields polygons for 483 of today's 495 upazilas plus 61 metropolitan
  thanas. These twelve current upazilas remain searchable but use a district
  fallback because drawing an invented boundary would be misleading:
  Taltali, Karnafuli, Eidgaon, Lalmai, Shayestaganj, Guimara, Dasar, Tarakanda,
  Naldanga, Rangabali, Madhyanagar, and Osmaninagar.
- Administrative polygons are useful for selection and visual orientation, not
  as claims about distribution-company or feeder territory.
- Mirpur DOHS uses a deliberately approximate Pallabi-plus-Turag highlight; the
  app does not claim those two administrative polygons are its locality or
  feeder boundary.
- Coastlines and small islands are simplified for a national interactive map;
  this dataset is not suitable for surveying, cadastral work, or legal use.
- The National Portal has occasionally shown inconsistent aggregate counters.
  The bundled hierarchy uses the published 495-upazila list rather than treating
  counts of portal sites as newly gazetted administrative boundaries.

## Rebuilding

Run `scripts/geo/build_map.py` with local copies of the four pinned source files.
The script uses only Python's standard library. `scripts/geo/validate.mjs`
performs structural and contract checks on the generated output.
