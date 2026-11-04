# Account naming

This is the only source of truth for generated accounts.

| Field | Rule | Example |
|---|---|---|
| `name` | prefix + sequence | `stu001` |
| sequence start | 001 | `001` |
| padding | 3 digits; naturally wider after 999 | `stu999` → `stu1000` |
| prefix | 2–16 chars, `[A-Za-z0-9]` only | `stu` |
| batch size | 1–100 | `3` |
| `displayName` | same as `name` unless later updated | `stu001` |
| `password` | `if123456` | |
| `type` | `normal` | |
| `owner` | selected organization `name` | |
| `groups` | zero or more `owner/groupName` | `acme/students` |
| email / phone | not collected on create | |

Existing-name policy: that row fails with `already_exists`; do not overwrite, do not change password, do not skip to the next free number.

Batch delete by prefix only matches `^<prefix>\\d+$` (so `stu` does not delete `student`).
