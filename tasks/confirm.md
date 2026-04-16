size: medium
---

a similar confirm concept to pgkit (../pgkit), which in the CLI, shows you some text, which could optionally be editable (e.g. for "sql that will run as a result of this command") or in the UI could use SSE cleverness or an HTTP stream to show a modal, which could *also* be editable.

we should probably introduce shadcn components for this since there's prior art for "Dialog" and similar. And while we're there we could add shadcn toast support too. And toass, we could show an error toast in the global tanstack react query mutation onError.
