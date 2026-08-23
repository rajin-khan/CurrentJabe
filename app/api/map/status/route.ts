import { getMapStatus } from "@/lib/server/area-data";
import { cachedSuccess, routeError } from "@/lib/server/http";

export async function GET() {
  try {
    return cachedSuccess(await getMapStatus(), 30);
  } catch (error) {
    return routeError(error);
  }
}

