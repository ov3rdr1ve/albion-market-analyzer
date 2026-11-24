; Npcap handling for the Albion Market Analyzer installer.
;
; The live market monitor reads the game's own traffic through npcap, a capture
; driver this app does not own and MAY NOT SHIP: the free Npcap licence grants
; no redistribution rights, and its silent installer (/S) is an Npcap OEM
; feature. So the installer does what it legitimately can —
;
;   1. detect whether npcap is already on the machine,
;   2. if a LICENSED OEM installer was placed at build/npcap/npcap.exe by
;      whoever built this package, run it (silently, as that licence allows),
;   3. otherwise offer to open npcap.com so the user installs it themselves.
;
; Nothing here is fatal: the rest of the app — scanning, crafting, flipping —
; works without a capture driver, and the app itself re-checks and offers the
; install again on first run (see js/npcap-status.js). A declined or failed
; npcap install must still leave a working installation behind.
;
; Registers, not Var: this macro is inserted INSIDE a section, where new
; variables cannot be declared. Relative jumps (+2) rather than labels, so a
; second insertion could never collide on a label name.

!include LogicLib.nsh

; $R8 <- "1" when the capture driver is present.
;
; The SYSTEM hive is not subject to WOW64 registry redirection, so the driver
; service is the reading that cannot go wrong from this 32-bit installer. The
; file checks are the fallback: $WINDIR\Sysnative is the real 64-bit System32
; seen from a 32-bit process, and SysWOW64 covers the 32-bit DLL set.
!macro albionDetectNpcap
  StrCpy $R8 "0"
  ClearErrors
  ReadRegStr $R9 HKLM "SYSTEM\CurrentControlSet\Services\npcap" "ImagePath"
  ${IfNot} ${Errors}
    StrCpy $R8 "1"
  ${EndIf}
  ${If} $R8 == "0"
  ${AndIf} ${FileExists} "$WINDIR\Sysnative\Npcap\wpcap.dll"
    StrCpy $R8 "1"
  ${EndIf}
  ${If} $R8 == "0"
  ${AndIf} ${FileExists} "$WINDIR\SysWOW64\Npcap\wpcap.dll"
    StrCpy $R8 "1"
  ${EndIf}
  ${If} $R8 == "0"
  ${AndIf} ${FileExists} "$WINDIR\System32\wpcap.dll"
    StrCpy $R8 "1"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro albionDetectNpcap

  ${If} $R8 == "0"
!if /FileExists "${BUILD_RESOURCES_DIR}\npcap\npcap.exe"
    ; A licensed Npcap OEM installer was bundled at build time. That licence is
    ; what permits both the redistribution and the /S below.
    StrCpy $R7 "no"
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "The live market monitor needs the Npcap capture driver, which is not installed.$\r$\n$\r$\nInstall it now? (Recommended — the rest of the app works without it.)" \
      /SD IDYES IDNO +2
    StrCpy $R7 "yes"

    ${If} $R7 == "yes"
      DetailPrint "Installing Npcap..."
      File /oname=$PLUGINSDIR\npcap.exe "${BUILD_RESOURCES_DIR}\npcap\npcap.exe"
      ExecWait '"$PLUGINSDIR\npcap.exe" /S /winpcap_mode=yes' $R6
      ; 3010 = installed, reboot required. Any other non-zero code is a real
      ; failure, and the app offers the install again on its next start.
      ${If} $R6 != 0
      ${AndIf} $R6 != 3010
        DetailPrint "Npcap installer returned $R6 — the app will offer it again on first run."
      ${EndIf}
    ${EndIf}
!else
    ; No bundled installer: point the user at the official download instead.
    ; Defaults to NO on a silent install, where nothing may open a browser.
    StrCpy $R7 "no"
    MessageBox MB_YESNO|MB_ICONINFORMATION \
      "The live market monitor needs the Npcap capture driver, which is not installed.$\r$\n$\r$\nNpcap is a separate free download from npcap.com. Open its download page now?$\r$\n$\r$\n(The rest of the app — scanning, crafting, flipping — works without it.)" \
      /SD IDNO IDNO +2
    StrCpy $R7 "yes"

    ${If} $R7 == "yes"
      ExecShell "open" "https://npcap.com/#download"
    ${EndIf}
!endif
  ${EndIf}
!macroend
