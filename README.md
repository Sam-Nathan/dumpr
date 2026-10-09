# Dumpr

Dumpr is a camera-first shared-photo app. A **Crew** is a group of friends, a **Roll** is a shared
set of photos (a night out, a trip), and everyone's **Photos** land in one place, with no chasing.
One Expo codebase ships to Android and iOS; a Next.js site handles marketing and invite links.
Backend: Supabase (auth, Postgres, edge functions) and Cloudflare R2 (photo storage).

## Layout

```
apps/mobile      Expo SDK 57 app (expo-router, NativeWind)       @dumpr/mobile
apps/web         Next.js 16 site, invite landing, app-link files  @dumpr/web
packages/core    Pure TypeScript domain logic (no runtime deps)   @dumpr/core
packages/db      Typed Supabase client wrapper                    @dumpr/db
packages/ui-tokens  Design tokens (tokens.json) + Tailwind preset @dumpr/ui-tokens
supabase         Config, migrations, pgTAP tests, edge functions
docs/blueprint   Product and architecture blueprint
```

## Commands

```
pnpm install
pnpm dev                      # turbo dev (web)
pnpm --filter @dumpr/mobile start   # Expo dev server
pnpm typecheck | pnpm test | pnpm lint | pnpm format:check
pnpm --filter @dumpr/web build
pnpm test:db                  # migrations + pgTAP on a plain PostgreSQL (needs psql, pg_prove)
```

Copy `apps/mobile/.env.example` and `apps/web/.env.example` to `.env` / `.env.local`.
