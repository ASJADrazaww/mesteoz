$ErrorActionPreference = 'Stop'
$env:PORT = '3111'
$root = 'c:\Users\91831\Documents\mesteoz'
$proc = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root -PassThru -WindowStyle Hidden
$base = 'http://127.0.0.1:3111'
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $null = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 2
    $ready = $true
    break
  } catch {
    if ($proc.HasExited) { break }
  }
}
if (-not $ready) { throw "Server on $base did not become ready." }

function Post($path, $body, $token) {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  return Invoke-RestMethod -Uri "$base$path" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6) -Headers $headers
}
function Fetch($path, $token) {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  return Invoke-RestMethod -Uri "$base$path" -Headers $headers
}

try {
  Write-Output "HEALTH: $((Fetch '/api/health').ok)"
  Write-Output "EDITORS BEFORE: $((Fetch '/api/editors').data.Count)"
  Write-Output "PROJECTS BEFORE: $((Fetch '/api/projects').data.Count)"
  $s0 = Fetch '/api/stats'
  Write-Output "STATS BEFORE: editors=$($s0.data.editors) projects=$($s0.data.projects) connections=$($s0.data.connections)"

  $clientReg = Post '/api/auth/register' @{ fullName = 'Ravi Client'; phone = '+91 9000000001'; email = 'ravi@example.com'; password = 'password123'; instagram = 'ravicreates' }
  $clientToken = $clientReg.token
  Write-Output "CLIENT REGISTERED: $($clientReg.user.name) role=$($clientReg.user.role) onboarding=$($clientReg.user.onboardingComplete)"
  Write-Output "CHECK PHONE: $((Post '/api/auth/check-phone' @{ phone = '9000000001' }).data.exists)"

  $ob = Post '/api/auth/onboarding' @{ role = 'client'; phone = '+91 9000000001'; instagram = 'ravicreates'; projectTitle = 'Weekly YouTube edits for a finance channel'; projectCategory = 'YouTube'; projectBudget = '800'; projectDeadline = '3 days'; projectDescription = 'One long-form video plus four shorts every week'; location = 'Delhi' } $clientToken
  Write-Output "CLIENT ONBOARDING: msg='$($ob.connection.message)' role=$($ob.user.role) complete=$($ob.user.onboardingComplete)"

  $projects = Fetch '/api/projects'
  Write-Output "PROJECTS AFTER CLIENT: $($projects.data.Count) title='$($projects.data[0].title)' client='$($projects.data[0].client)' leakedPhone=$([bool]$projects.data[0].phone)"

  $req = Fetch '/api/requests' $clientToken
  Write-Output "CLIENT REQUESTS: connections=$($req.data.connections.Count) connected=$($req.data.counts.connected) searching=$($req.data.counts.searching)"
  $editorReg = Post '/api/auth/register' @{ fullName = 'Priya Editor'; phone = '+91 9000000002'; email = 'priya@example.com'; password = 'password123'; instagram = 'priyaedits' }
  $editorToken = $editorReg.token
  $editorOb = Post '/api/auth/onboarding' @{ role = 'editor'; phone = '+91 9000000002'; instagram = 'priyaedits'; title = 'YouTube & Short-form Editor'; bio = 'I cut clean, fast YouTube edits.'; skills = @('YouTube', 'Shorts', 'Storytelling'); software = @('Premiere Pro'); experience = 'Pro'; startingPrice = 40; availability = 'Available now'; location = 'Delhi' } $editorToken
  Write-Output "EDITOR ONBOARDING: msg='$($editorOb.connection.message)' role=$($editorOb.user.role)"

  $editors = Fetch '/api/editors'
  Write-Output "EDITORS AFTER: $($editors.data.Count) name='$($editors.data[0].name)' title='$($editors.data[0].title)' leakedPhone=$([bool]$editors.data[0].phone)"

  $clientConn = Fetch '/api/connections' $clientToken
  Write-Output "CLIENT CONNECTIONS: $($clientConn.data.Count) partner='$($clientConn.data[0].partner.name)' status=$($clientConn.data[0].status) score=$($clientConn.data[0].score) phone=$($clientConn.data[0].contact.phone) insta=$($clientConn.data[0].contact.instagram)"

  $editorConn = Fetch '/api/connections' $editorToken
  Write-Output "EDITOR CONNECTIONS: $($editorConn.data.Count) partner='$($editorConn.data[0].partner.name)' status=$($editorConn.data[0].status) phone=$($editorConn.data[0].contact.phone)"

  $dash = Fetch '/api/dashboard/client' $clientToken
  Write-Output "DASHBOARD CLIENT: '$($dash.data.title)' metrics=$($dash.data.metrics.Count) conns=$($dash.data.connections.Count) m0=$($dash.data.metrics[0] -join '/')"
  $dashE = Fetch '/api/dashboard/editor' $editorToken
  Write-Output "DASHBOARD EDITOR: '$($dashE.data.title)' metrics=$($dashE.data.metrics.Count) m0=$($dashE.data.metrics[0] -join '/')"

  $accept = Post "/api/connections/$($clientConn.data[0].id)/status" @{ status = 'accepted' } $clientToken
  Write-Output "ACCEPT REQUEST: $($accept.message) status=$($accept.data.status)"

  $apply = Post "/api/projects/$($projects.data[0].id)/apply" @{} $editorToken
  Write-Output "APPLY TO PROJECT: $($apply.message) created=$($apply.created)"

  $c2 = Post '/api/auth/register' @{ fullName = 'Aisha Brand'; phone = '+91 9000000003'; email = 'aisha@example.com'; password = 'password123'; instagram = 'aishabrand' }
  $c2Token = $c2.token
  Post '/api/auth/onboarding' @{ role = 'client'; phone = '+91 9000000003'; projectTitle = 'Launch ad cutdowns'; projectCategory = 'Ads'; projectBudget = '1200'; projectDeadline = '5 days'; projectDescription = 'Three ad cutdowns for launch week'; location = 'Mumbai' } $c2Token | Out-Null
  $editorId = (Fetch '/api/editors').data[0].id
  $direct = Post "/api/connect/editor/$editorId" @{} $c2Token
  Write-Output "DIRECT CONNECT: partner='$($direct.data.connection.partner.name)' status=$($direct.data.connection.status) phone=$($direct.data.connection.contact.phone)"

  $byPhone = Post '/api/connect/contact' @{ phone = '+91 9000000001' } $editorToken
  Write-Output "CONTACT CONNECT (editor->client phone): msg='$($byPhone.message)' status=$($byPhone.data.connection.status) insta=$($byPhone.data.connection.contact.instagram)"

  $byHandle = Post '/api/connect/contact' @{ instagram = '@priyaedits' } $clientToken
  Write-Output "CONTACT CONNECT (client->editor handle): msg='$($byHandle.message)' status=$($byHandle.data.connection.status) phone=$($byHandle.data.connection.contact.phone)"

  try {
    Post '/api/connect/contact' @{ phone = '+91 9999999999' } $editorToken | Out-Null
    Write-Output 'CONTACT CONNECT (unknown contact): unexpected-success'
  } catch {
    Write-Output "CONTACT CONNECT (unknown contact): $($_.ErrorDetails.Message)"
  }
  try {
    Post '/api/connect/contact' @{} $clientToken | Out-Null
    Write-Output 'CONTACT CONNECT (empty body): unexpected-success'
  } catch {
    Write-Output "CONTACT CONNECT (empty body): $($_.ErrorDetails.Message)"
  }

  $login = Post '/api/auth/login' @{ email = '9000000001'; password = 'password123' }
  Write-Output "LOGIN BY PHONE: '$($login.user.name)' msg='$($login.connection.message)'"

  $notifications = Fetch '/api/notifications' $clientToken
  Write-Output "NOTIFICATIONS: $($notifications.data.Count) first='$($notifications.data[0].title)'"

  $s1 = Fetch '/api/stats'
  Write-Output "STATS AFTER: editors=$($s1.data.editors) clients=$($s1.data.clients) projects=$($s1.data.projects) connections=$($s1.data.connections)"

  $page = (Invoke-WebRequest -Uri "$base/" -UseBasicParsing).Content
  Write-Output "PAGE: length=$($page.Length) fakeAlex=$($page -match 'Alex Morgan') fakeNorthstar=$($page -match 'northstar') hasTracker=$($page -match 'tracker-list') hasSocket=$($page -match 'socket.io.js')"
} finally {
  Stop-Process -Id $proc.Id -Force
  Write-Output 'SERVER STOPPED'
}