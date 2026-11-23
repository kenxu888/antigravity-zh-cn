Option Explicit

Dim fso, shell, scriptDir, launcherPath, candidate, nodePath, cmd
Dim candidates(2)
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcherPath = fso.BuildPath(scriptDir, "launcher.mjs")

candidates(0) = "C:\Program Files\nodejs\node.exe"
candidates(1) = "C:\Program Files (x86)\nodejs\node.exe"
candidates(2) = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe")

nodePath = ""
For Each candidate In candidates
  If fso.FileExists(candidate) Then
    nodePath = candidate
    Exit For
  End If
Next

If nodePath <> "" Then
  cmd = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34)
  shell.Run cmd, 0, False
Else
  On Error Resume Next
  cmd = "node " & Chr(34) & launcherPath & Chr(34)
  shell.Run cmd, 0, False
  If Err.Number <> 0 Then
    Err.Clear
    MsgBox "Node.js (v22+) not found. Please install Node.js LTS from https://nodejs.org/", vbCritical, "Antigravity Chinese Launcher"
  End If
  On Error GoTo 0
End If
