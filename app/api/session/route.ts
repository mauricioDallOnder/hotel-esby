import {
  authorized,
  clearSession,
  passwordMatches,
  setSession,
} from "@/lib/auth";

import { errorResponse, readBody } from "@/lib/http";
import { DomainError } from "@/lib/domain";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      authenticated: await authorized(),
      configured: !!process.env.APP_PASSWORD,
      hotelName: process.env.HOTEL_NAME || "Mon hôtel",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    // Verifica Origin somente em produção
    if (process.env.NODE_ENV === "production") {
      const origin = request.headers.get("origin");

      if (origin && origin !== new URL(request.url).origin) {
        throw new DomainError("Origine non autorisée.", 403);
      }
    }

    const { password } = z
      .object({
        password: z.string().max(300),
      })
      .parse(await readBody(request, 1000));

    if (!passwordMatches(password)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      throw new DomainError("Mot de passe incorrect.", 401);
    }

    await setSession();

    return Response.json({
      ok: true,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  // Verifica Origin somente em produção
  if (process.env.NODE_ENV === "production") {
    const origin = request.headers.get("origin");

    if (origin && origin !== new URL(request.url).origin) {
      return Response.json(
        {
          error: "Origine non autorisée.",
        },
        {
          status: 403,
        }
      );
    }
  }

  await clearSession();

  return Response.json({
    ok: true,
  });
}