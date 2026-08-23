import { NextRequest } from "next/server";
import { getAreaSnapshot } from "@/lib/server/area-data";
import { routeError, success } from "@/lib/server/http";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const data = await getAreaSnapshot({
      slug,
      providerId: request.nextUrl.searchParams.get("providerId"),
      feederId: request.nextUrl.searchParams.get("feederId"),
    });
    return success(data);
  } catch (error) {
    return routeError(error);
  }
}

