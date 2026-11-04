# Casdoor API notes

Endpoint: `https://auth.innerfireai.com`. All calls go through `scripts/casdoor.mjs`. Do not hand-write curl for writes.

## Envelope

Every Management API response is HTTP 200 with `{status, msg, data, data2}`. Trust `data` only when `status === "ok"`. CLI already unwraps this and maps:

| Casdoor msg | CLI `code` |
|---|---|
| Please sign in / token missing or expired | `unauthenticated` → 请用户重新 `login` |
| No permission | `forbidden` |
| already exists | `already_exists`（该条失败，批次继续） |
| not found | `not_found` |
| redirect_uri … | `config`（应用 Redirect URL 未配置） |
| network / DNS / timeout | `unreachable` |

Token 接口 `/api/login/oauth/access_token` 不是这套 envelope，是标准 OAuth JSON。CLI 已分开处理。

## Composite id

`get-user` / `update-user` 的 `id` 是 `owner/name`。Organization 对象自己的 owner 固定为 `admin`，与租户 `name` 不是一回事。Group 的 owner 是租户 `name`。

## Endpoints used

| CLI | Method | Path |
|---|---|---|
| whoami / P0 | GET | `/api/get-account` |
| orgs | GET | `/api/get-organizations`（分页到取完） |
| groups | GET | `/api/get-groups?owner=` |
| users list | GET | `/api/get-users?owner=` |
| users get | GET | `/api/get-user?id=owner/name` |
| users add | POST | `/api/add-user` |
| users update | POST | `/api/update-user?id=owner/name` |
| users reset-password | POST | `/api/set-password`（form: userOwner, userName, newPassword） |
| users delete | POST | `/api/delete-user` |

## update-user is replace

Casdoor 更新是整对象覆盖。CLI 会先 GET 再合并再 POST，并且从 payload 里去掉 `password` / `passwordSalt`。不要绕过 CLI 自己拼 update body。

`groups` 存的是 `租户/分组name` 数组。多选即多个元素；清空用 `--clear-groups`。

启用/停用映射：`--enabled false` → `isForbidden: true`。

## Auth

OAuth Authorization Code + PKCE（S256），scope `openid profile email offline_access`。

- authorize: `https://auth.innerfireai.com/login/oauth/authorize`
- token: `https://auth.innerfireai.com/api/login/oauth/access_token`
- clientId: `f9000a01deab6f84d57c`
- redirect: `http://127.0.0.1:18765/callback`（端口写死，被占用就失败，不要换端口）

Session: `~/.config/casdoor-account-admin/session.json`（0600）。过期会用 refresh_token 续，续失败则要求重新 login。
