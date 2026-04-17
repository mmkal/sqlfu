local.sqlfu.dev should have a "Demo" button which takes you to a fresh workspace which uses a browser sqlite implementation for messing around just for your session. using https://sqlite.org/wasm/doc/trunk/demo-123.md

hosted at demo.local.sqlfu.dev

likely doesn't need a full packages/<anything> - it's just packages/ui but with a baked in backend (maybe orpc can be persuaded to not use fetch, but instead hit a whatwg-fetch-based local "server"? I guess it'd need to bundle all of sqlfu's backend in the browser which sounds messy but possible! maybe it will need a packages/demo...)
