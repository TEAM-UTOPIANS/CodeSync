// GET /api/languages -> {languages: {id: {provider, version} | null}}
// Live view of which compiler each remote language resolves to. Cached at the Vercel edge.
import { resolveVersions } from "../public/js/providers.js";

export default async function handler(req, res) {
  try {
    const languages = await resolveVersions({ signal: AbortSignal.timeout(15_000) });
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ languages });
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "Could not reach the compiler services." });
  }
}
