import { NextRequest } from "next/server";
import { validateCommunityLocality } from "@/lib/domain/validation";
import { assertSameOrigin, readJson, routeError, success } from "@/lib/server/http";
import { createCommunityLocality, getLocalities } from "@/lib/server/localities";
import { attachVisitorCookie, getOrCreateVisitor } from "@/lib/server/visitor";

export async function GET(request: NextRequest) {
  try {
    const parentId = request.nextUrl.searchParams.get("parentId") ?? "";
    return success(await getLocalities(parentId));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = validateCommunityLocality(await readJson(request));
    const identity = getOrCreateVisitor(request);
    const result = await createCommunityLocality({
      parentId: input.parentId,
      inputLocale: input.inputLocale,
      name: input,
      visitorHash: identity.visitorHash,
      ipHash: identity.ipHash,
    });
    const response = success(result, { status: result.created ? 201 : 200 });
    attachVisitorCookie(response, identity);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
