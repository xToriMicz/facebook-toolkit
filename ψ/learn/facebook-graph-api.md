# Facebook Graph API Research

> Source: developers.facebook.com (fetched 2026-03-22)

## 1. Overview

- Base URL: `https://graph.facebook.com/v25.0/`
- All requests require HTTPS
- Responses in JSON
- Methods: GET, POST, DELETE + batch requests
- Almost every endpoint requires an access token

## 2. Post to Facebook Page

### Text Post

```bash
curl -X POST "https://graph.facebook.com/v25.0/{page-id}/feed" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "ข้อความโพสต์",
    "access_token": "<PAGE_ACCESS_TOKEN>"
  }'
```

Response: `{"id": "page_post_id"}`

### Scheduled Post

```bash
curl -X POST "https://graph.facebook.com/v25.0/{page-id}/feed" \
  -d "message=ข้อความ" \
  -d "published=false" \
  -d "scheduled_publish_time=1711234567" \
  -d "access_token=<TOKEN>"
```

- `scheduled_publish_time`: 10 min to 30 days in future
- Accepts UNIX timestamp, ISO 8601, or PHP strtotime format

### Post with Link

```bash
curl -X POST "https://graph.facebook.com/v25.0/{page-id}/feed" \
  -d "message=ดูบทความนี้" \
  -d "link=https://ge.makeloops.xyz" \
  -d "access_token=<TOKEN>"
```

## 3. Upload Photo to Page

### Via URL (image hosted elsewhere)

```bash
curl -X POST "https://graph.facebook.com/v25.0/{page-id}/photos" \
  -d "url=https://example.com/image.jpg" \
  -d "caption=คำอธิบายรูป" \
  -d "published=true" \
  -d "access_token=<TOKEN>"
```

### Via File Upload (multipart)

```bash
curl -X POST "https://graph.facebook.com/v25.0/{page-id}/photos" \
  -F "source=@/path/to/image.jpg" \
  -F "caption=คำอธิบายรูป" \
  -F "published=true" \
  -F "access_token=<TOKEN>"
```

### Photo Specs

- Formats: .jpeg, .bmp, .png, .gif, .tiff
- Max size: 4 MB
- PNG recommended under 1 MB to prevent pixelation
- Use `caption` (not `message` which is deprecated)

## 4. Access Tokens

### Token Types

| Type | Use | Expiry |
|------|-----|--------|
| App Token | Server-to-server | Never |
| User Token (short) | User login | ~1 hour |
| User Token (long) | Extended user | ~60 days |
| Page Token (from long-lived user) | Page operations | Never expires* |

*Page tokens derived from long-lived user tokens don't expire under normal conditions.

### Get Long-Lived Token (3 steps)

**Step 1: Get short-lived user token**
- User logs in via Facebook Login
- Returns short-lived token (~1 hour)

**Step 2: Exchange for long-lived user token**

```bash
GET https://graph.facebook.com/v25.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={app-id}
  &client_secret={app-secret}
  &fb_exchange_token={short-lived-token}
```

Response: `{"access_token": "long-lived-token", "expires_in": 5184000}`

**Step 3: Get page token (never-expiring)**

```bash
GET https://graph.facebook.com/v25.0/{user-id}/accounts
  ?access_token={long-lived-user-token}
```

Response includes `access_token` per page — these page tokens don't expire.

IMPORTANT: Step 2 must be server-side (app secret exposed).

## 5. Required Permissions

| Permission | For |
|-----------|-----|
| `pages_manage_posts` | Create/edit/delete posts and photos |
| `pages_read_engagement` | Read post metrics, comments, likes |
| `pages_read_user_engagement` | Read user-level engagement |
| `publish_video` | Video posts only |

App must also have CREATE_CONTENT task permission on the Page.

## 6. Rate Limits

### App-Level

```
Calls per hour = 200 * Number of Daily Active Users
```

### Error Codes When Throttled

| Code | Meaning |
|------|---------|
| 4 | App-level limit |
| 17 | User-level limit |
| 32 | Page request limit |
| 80001-80014 | Business use case limits |

### Monitor via Response Headers

- `X-App-Usage`: `{"call_count": 28, "total_cputime": 25, "total_time": 30}` (percentages)
- `estimated_time_to_regain_access`: minutes until throttle lifts

### Best Practices

- Stop immediately when throttled (continued requests extend recovery)
- Distribute queries evenly, avoid spikes
- Use filters to minimize response size
- Batch multiple IDs in single requests
- Monitor X-App-Usage headers proactively

## 7. Creating a Facebook App

1. Go to https://developers.facebook.com/apps/
2. Create App > Select "Business" type
3. Add "Facebook Login" product
4. Configure OAuth redirect URI
5. Get App ID + App Secret from Settings > Basic
6. Request permissions via App Review (pages_manage_posts etc.)
7. For testing: use your own Page without App Review

## 8. Quick Reference: Posting Flow

```
1. Create Facebook App → get App ID + Secret
2. Login as Page Admin → get short-lived user token
3. Exchange → long-lived user token (60 days)
4. GET /me/accounts → get never-expiring Page token
5. POST /{page-id}/feed → text post
6. POST /{page-id}/photos → photo post
```

Store the Page token securely — it doesn't expire.
