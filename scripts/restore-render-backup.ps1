param(
  [Parameter(Mandatory = $true)]
  [string]$EncryptedBackupPath,

  [Parameter(Mandatory = $true)]
  [string]$ProtectedKeyPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$cipherPath = (Resolve-Path -LiteralPath $EncryptedBackupPath).Path
$keyPath = (Resolve-Path -LiteralPath $ProtectedKeyPath).Path
$target = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $target) {
  throw 'Refusing to overwrite an existing restore target.'
}

$saved = [IO.File]::ReadAllBytes($cipherPath)
if ($saved.Length -lt 73) {
  throw 'Encrypted backup is too short.'
}
$magic = [Text.Encoding]::ASCII.GetString($saved, 0, 8)
if ($magic -ne 'NRBAK001') {
  throw 'Encrypted backup format is not recognized.'
}

$keyMaterial = $null
$decrypted = $null
try {
  $keyMaterial = [System.Security.Cryptography.ProtectedData]::Unprotect(
    [IO.File]::ReadAllBytes($keyPath),
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  if ($keyMaterial.Length -ne 64) {
    throw 'Protected key has an invalid length.'
  }

  $authenticated = [byte[]]$saved[0..($saved.Length - 33)]
  $savedTag = [byte[]]$saved[($saved.Length - 32)..($saved.Length - 1)]
  $hmac = New-Object Security.Cryptography.HMACSHA256 (,([byte[]]$keyMaterial[32..63]))
  try {
    $computedTag = $hmac.ComputeHash($authenticated)
  } finally {
    $hmac.Dispose()
  }
  if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$savedTag, [byte[]]$computedTag)) {
    throw 'Backup authentication failed.'
  }

  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.KeySize = 256
    $aes.BlockSize = 128
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = [byte[]]$keyMaterial[0..31]
    $aes.IV = [byte[]]$saved[8..23]
    $decryptor = $aes.CreateDecryptor()
    try {
      $cipher = [byte[]]$saved[24..($saved.Length - 33)]
      $decrypted = $decryptor.TransformFinalBlock($cipher, 0, $cipher.Length)
    } finally {
      $decryptor.Dispose()
    }
  } finally {
    $aes.Dispose()
  }

  $targetDirectory = [IO.Path]::GetDirectoryName($target)
  if ($targetDirectory) {
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  }
  [IO.File]::WriteAllBytes($target, $decrypted)
  [pscustomobject]@{
    OutputPath = $target
    Bytes = $decrypted.Length
    SHA256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    AuthenticationVerified = $true
  }
} finally {
  if ($keyMaterial) { [Array]::Clear($keyMaterial, 0, $keyMaterial.Length) }
  if ($decrypted) { [Array]::Clear($decrypted, 0, $decrypted.Length) }
}
