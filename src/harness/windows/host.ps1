param([string]$Source = "$PSScriptRoot\host.cs")
# The Windows host, started once per driver: compiles host.cs, then answers a
# JSON request per line on stdin with a JSON answer per line on stdout until
# stdin closes. Everything a step does is in the C#; this only hosts it.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

# Loaded by name first, then handed to the compiler by path: a reference by
# name alone is not resolved the same way for every assembly.
$names = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')
foreach ($name in $names) { Add-Type -AssemblyName $name }
$references = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $names -contains $_.GetName().Name } | ForEach-Object { $_.Location }
Add-Type -Path $Source -ReferencedAssemblies $references

[HarnessHost]::Serve([Console]::In, [Console]::Out, 'powershell')
