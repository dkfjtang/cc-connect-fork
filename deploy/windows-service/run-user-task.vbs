Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "F:\development\cc-connect-service"
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""F:\development\cc-connect-service\run-user-task.ps1""", 0, False
