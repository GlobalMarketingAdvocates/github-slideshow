# Engagement Blitz Skool Actor (Apify + Playwright + Chrome)

Lightweight Apify actor for **Skool scanning and posting** using authenticated session cookies.

## What this actor does

- Uses **Playwright + Chrome** (Apify Playwright Chrome base image).
- Accepts Skool **session cookies** and opens a group while authenticated.
- Scans only the latest posts/comments (bounded by `maxPostsToCheck`) for low-cost runs.
- Detects:
  - new posts
  - new comments
  - mentions of `targetUsername`
  - optional Blitz tab scan (`scanBlitzTab`)
- Extracts minimal fields:
  - `postId`, `commentId`, `author`, `text`, `timestamp`, `url`, `mentions`
- Stores last-seen post/comment IDs in Apify Key-Value Store to avoid duplicates.
- Sends JSON to your `webhookUrl` (Pabbly).
- Supports second mode (`post`) for posting a reply/comment with same session cookies.

> No AI, GIF, or content-generation logic is included.

## Files

- `src/main.js` - actor logic (scan + post modes)
- `input_schema.json` - Apify input schema
- `.actor/actor.json` - actor metadata
- `Dockerfile` - Apify build image and startup command
- `examples/input.scan.json` - sample scan input
- `examples/input.post.json` - sample post input
- `examples/webhook.payload.scan.json` - sample scan webhook output
- `examples/webhook.payload.post.json` - sample post webhook output

## Input schema fields

- `groupUrl`
- `cookies`
- `targetUsername`
- `maxPostsToCheck`
- `scanMentionsOnly`
- `scanComments`
- `scanBlitzTab`
- `webhookUrl`
- `mode` (`scan` or `post`)
- `replyContent` (used when `mode=post`)
- `postId` (used when `mode=post`)
- `parentId` (optional metadata for threaded context)

## Setup on Apify

1. Create a new Actor in Apify.
2. Upload this project (or connect GitHub repo).
3. Ensure build uses included `Dockerfile`.
4. In Actor input, paste JSON from:
   - scan mode: `examples/input.scan.json`
   - post mode: `examples/input.post.json`
5. Run actor.
6. Check dataset items and webhook receiver for payloads.

## Local run

```bash
npm install
npm start
```

Set input locally using Apify conventions, for example:

```bash
export APIFY_LOCAL_STORAGE_DIR=./apify_storage
cp examples/input.scan.json ./apify_storage/key_value_stores/default/INPUT.json
npm start
```

## Notes

- Keep `maxPostsToCheck` between **5 and 10** for cheapest runs.
- Cookie freshness is critical; expired session cookies will fail authentication.
- Skool DOM can change; selectors in `src/main.js` are intentionally flexible but may need updates over time.
