---
status: in-progress
size: small
---

Tracked in PR #25 (recipes: copy-pasteable sqlite id-generator snippets).

something like kiwicopple's pure sql id generator things (ksuid etc.) could be built in to this. either as a copy-pastable migration, or agent instructions, or idk what. tbh this may expose a shortcoming in the deifnitions.sql model. how does a user incorporate a big external bundle of sql functions? for ksuid, it's small enough to copy paste. but what if it's the whole fdb schema or something?
