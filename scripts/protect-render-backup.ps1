param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$DestinationDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$allowedDownloads = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Downloads'))
$sourceDirectory = [IO.Path]::GetDirectoryName($resolvedSource)
if ($sourceDirectory -ne $allowedDownloads) {
  throw 'The plaintext backup must be an explicitly named file in the current user Downloads directory.'
}
if ([IO.Path]::GetExtension($resolvedSource) -ne '.gz') {
  throw 'Expected a Render .dir.tar.gz export.'
}

$destination = [IO.Path]::GetFullPath($DestinationDirectory)
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$baseName = [IO.Path]::GetFileName($resolvedSource) -replace '\.dir\.tar\.gz$', ''
$cipherPath = Join-Path $destination "$baseName.dir.tar.gz.nrbak"
$keyPath = Join-Path $destination "$baseName.dpapi-key"
$manifestPath = Join-Path $destination "$baseName.manifest.txt"

$plain = [IO.File]::ReadAllBytes($resolvedSource)
$keyMaterial = New-Object byte[] 64
$iv = New-Object byte[] 16
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$aes = $null
$encryptor = $null
$hmac = $null
$sha = $null
$unprotected = $null
$decrypted = $null

try {
  $rng.GetBytes($keyMaterial)
  $rng.GetBytes($iv)

  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256
  $aes.BlockSize = 128
  $aes.Mode = [Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = [byte[]]$keyMaterial[0..31]
  $aes.IV = $iv
  $encryptor = $aes.CreateEncryptor()
  $cipher = $encryptor.TransformFinalBlock($plain, 0, $plain.Length)

  $magic = [Text.Encoding]::ASCII.GetBytes('NRBAK001')
  $authenticated = New-Object byte[] ($magic.Length + $iv.Length + $cipher.Length)
  [Array]::Copy($magic, 0, $authenticated, 0, $magic.Length)
  [Array]::Copy($iv, 0, $authenticated, $magic.Length, $iv.Length)
  [Array]::Copy($cipher, 0, $authenticated, $magic.Length + $iv.Length, $cipher.Length)

  $hmac = New-Object Security.Cryptography.HMACSHA256 (,([byte[]]$keyMaterial[32..63]))
  $tag = $hmac.ComputeHash($authenticated)
  $output = New-Object byte[] ($authenticated.Length + $tag.Length)
  [Array]::Copy($authenticated, 0, $output, 0, $authenticated.Length)
  [Array]::Copy($tag, 0, $output, $authenticated.Length, $tag.Length)
  [IO.File]::WriteAllBytes($cipherPath, $output)

  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $keyMaterial,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [IO.File]::WriteAllBytes($keyPath, $protected)

  # Verify authentication and an exact decrypt round-trip before the source is removed.
  $unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect(
    [IO.File]::ReadAllBytes($keyPath),
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $saved = [IO.File]::ReadAllBytes($cipherPath)
  $savedAuthenticated = [byte[]]$saved[0..($saved.Length - 33)]
  $savedTag = [byte[]]$saved[($saved.Length - 32)..($saved.Length - 1)]
  $verifyHmac = New-Object Security.Cryptography.HMACSHA256 (,([byte[]]$unprotected[32..63]))
  try {
    $computedTag = $verifyHmac.ComputeHash($savedAuthenticated)
  } finally {
    $verifyHmac.Dispose()
  }
  if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$savedTag, [byte[]]$computedTag)) {
    throw 'Backup authentication failed.'
  }

  $verifyAes = [Security.Cryptography.Aes]::Create()
  try {
    $verifyAes.KeySize = 256
    $verifyAes.BlockSize = 128
    $verifyAes.Mode = [Security.Cryptography.CipherMode]::CBC
    $verifyAes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $verifyAes.Key = [byte[]]$unprotected[0..31]
    $verifyAes.IV = [byte[]]$saved[8..23]
    $decryptor = $verifyAes.CreateDecryptor()
    try {
      $savedCipher = [byte[]]$saved[24..($saved.Length - 33)]
      $decrypted = $decryptor.TransformFinalBlock($savedCipher, 0, $savedCipher.Length)
    } finally {
      $decryptor.Dispose()
    }
  } finally {
    $verifyAes.Dispose()
  }

  $sha = [Security.Cryptography.SHA256]::Create()
  $plainHash = ([BitConverter]::ToString($sha.ComputeHash($plain))).Replace('-', '')
  $decryptedHash = ([BitConverter]::ToString($sha.ComputeHash($decrypted))).Replace('-', '')
  if ($plainHash -ne $decryptedHash) {
    throw 'Decrypted backup hash mismatch.'
  }

  $cipherHash = (Get-FileHash -LiteralPath $cipherPath -Algorithm SHA256).Hash
  $manifest = @(
    'NexaRelay payment database backup',
    "Source file: $([IO.Path]::GetFileName($resolvedSource))",
    'Format: Render PostgreSQL directory archive (.dir.tar.gz), encrypted locally',
    'Encryption: AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC)',
    'Key protection: Windows DPAPI CurrentUser',
    "Plaintext SHA256: $plainHash",
    "Encrypted SHA256: $cipherHash",
    "Plaintext bytes: $($plain.Length)",
    "Encrypted bytes: $($output.Length)",
    'Verification: authentication and decrypt round-trip passed',
    'Restore status: isolated PostgreSQL restore drill pending'
  )
  [IO.File]::WriteAllLines($manifestPath, $manifest, (New-Object Text.UTF8Encoding($false)))

  Remove-Item -LiteralPath $resolvedSource -Force
  if (Test-Path -LiteralPath $resolvedSource) {
    throw 'The plaintext source still exists after deletion.'
  }

  [pscustomobject]@{
    EncryptedBackup = $cipherPath
    ProtectedKey = $keyPath
    Manifest = $manifestPath
    PlaintextRemoved = $true
    RoundTripVerified = $true
    PlaintextSHA256 = $plainHash
    EncryptedSHA256 = $cipherHash
  }
} finally {
  if ($sha) { $sha.Dispose() }
  if ($hmac) { $hmac.Dispose() }
  if ($encryptor) { $encryptor.Dispose() }
  if ($aes) { $aes.Dispose() }
  $rng.Dispose()
  if ($keyMaterial) { [Array]::Clear($keyMaterial, 0, $keyMaterial.Length) }
  if ($unprotected) { [Array]::Clear($unprotected, 0, $unprotected.Length) }
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
  if ($decrypted) { [Array]::Clear($decrypted, 0, $decrypted.Length) }
}
