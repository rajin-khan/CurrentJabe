import { NextRequest } from "next/server";
import { getLocationCatalog } from "@/lib/server/area-data";
import { cachedSuccess, routeError } from "@/lib/server/http";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const data = await getLocationCatalog({
      query: search.get("query"),
      districtId: search.get("districtId"),
      upazilaId: search.get("upazilaId"),
    });
    return cachedSuccess(data, 3_600);
  } catch (error) {
    return routeError(error);
  }
}

