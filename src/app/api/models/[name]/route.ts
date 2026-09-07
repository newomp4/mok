import { modelTransportResponse } from "@/lib/modelTransportServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  return modelTransportResponse(request, (await context.params).name);
}
export const HEAD = GET;
