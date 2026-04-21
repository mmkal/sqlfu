---
status: needs-grilling
size: medium
---

consider porting the outbox implementation in iterate into a general purpose one that uses sqlite's sometimes single-threadedness to mean we can use it as a queue fairly easily.