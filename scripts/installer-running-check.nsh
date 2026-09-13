; Keep installation independent of user PowerShell profiles. Never terminate an
; unrelated process or infer that a failed process query means nothing is running.
!macro customCheckAppRunning
  Var /GLOBAL stockCheckAttempts
  StrCpy $stockCheckAttempts 0
  System::Call 'kernel32::SetEnvironmentVariable(t "STOCK_LOOM_INSTALL_DIR", t "$INSTDIR")'
  stock_check_again:
    nsExec::Exec /TIMEOUT=15000 `"$PowerShellPath" -NoProfile -NonInteractive -Command "try { $$root=[IO.Path]::GetFullPath($$env:STOCK_LOOM_INSTALL_DIR).TrimEnd([char]92)+[char]92; $$found=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$root,[StringComparison]::OrdinalIgnoreCase) }); if ($$found.Count) { exit 0 } else { exit 1 } } catch { exit 2 }"`
    Pop $0
    StrCmp $0 1 stock_check_done
    StrCmp $0 0 stock_check_running stock_check_failed
  stock_check_running:
    IntOp $stockCheckAttempts $stockCheckAttempts + 1
    IntCmp $stockCheckAttempts 5 stock_check_prompt stock_check_wait stock_check_prompt
  stock_check_wait:
    Sleep 1000
    Goto stock_check_again
  stock_check_prompt:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Please close Stock Loom before continuing installation." /SD IDCANCEL IDRETRY stock_check_again
    SetErrorLevel 2
    Quit
  stock_check_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Unable to check running applications. Please close Stock Loom and retry installation." /SD IDOK
    SetErrorLevel 3
    Quit
  stock_check_done:
    System::Call 'kernel32::SetEnvironmentVariable(t "STOCK_LOOM_INSTALL_DIR", p 0)'
!macroend
