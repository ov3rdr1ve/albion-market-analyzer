# Optional: bundling the Npcap installer

The live market monitor captures the game's own network traffic through
**npcap**. Npcap is a separate Windows driver, not part of this app.

## Why it is not shipped here

The free/demo Npcap release **may not be redistributed**, and its silent
installer (`/S`) is an **Npcap OEM** feature. See <https://npcap.com/oem/redist.html>.

So the public build of this app never bundles npcap. Instead:

- the NSIS installer (`build/installer.nsh`) detects npcap and, if it is
  missing, offers to open <https://npcap.com/#download>;
- the app itself re-checks on every launch and on every "Start Monitor" click
  (`js/npcap-status.js`) and shows the same offer.

## If you hold an Npcap OEM redistribution licence

Drop the licensed installer in this directory named exactly:

```
build/npcap/npcap.exe
```

Then `npm run dist`. Two things change automatically:

1. `build/installer.nsh` compiles the bundled branch, which runs
   `npcap.exe /S /winpcap_mode=yes` during setup (silent, no user interaction);
2. the same file is copied into the packaged app at `resources/npcap/`, so the
   app can launch it later if the driver is removed or the user declined it
   during setup.

Nothing else needs editing. `.exe` files in this directory are the only thing
packaged from here — this README is not.
